/**
 * @fileoverview Stage 1 — Zero-Compute Text Extractor
 *
 * Extracts candidate place names from social media post signals **without
 * making any API calls**. Everything here runs purely on pattern matching,
 * emoji detection, curated lookup tables, and heuristics.
 *
 * The extractor is intentionally fast and cheap — it is always the first stage
 * in the pipeline and its output feeds every subsequent stage (geocoder,
 * verifier, vision, AI agent).
 *
 * ## What it extracts
 *
 * Signals are processed in priority order (highest → lowest confidence):
 *
 * 1. **Native GPS tag** (`source: "native_gps"`, conf 1.0)
 *    The platform's own location tag attached to the post (Instagram/TikTok POI).
 *
 * 2. **Anchor locations** (`source: "anchor_location"`, conf 0.97)
 *    Location strings embedded directly in TikTok video metadata (POI anchors).
 *
 * 3. **Pin emoji** (`source: "pin_emoji"`, conf 0.95)
 *    Text following 📍 📌 🌍 🌎 🌏 in caption, bio, or comments.
 *
 * 4. **Creator replies** (`source: "creator_reply"`, conf 0.90)
 *    Comments posted by the post author themselves — they filmed the content
 *    and are the most authoritative source of location information.
 *
 * 5. **Caption explicit** (`source: "caption_explicit"`, conf 0.85)
 *    Definite-article + landmark/feature noun patterns in the caption
 *    (e.g. "The Blue Lagoon", "filming at Horseshoe Bend").
 *
 * 6. **Geo hashtags** (`source: "geo_hashtag"`, conf 0.80)
 *    Hashtags matched against `KNOWN_GEO_HASHTAGS` (e.g. `#iceland`, `#bali`).
 *
 * 7. **Tagged accounts** (`source: "tagged_account"`, conf 0.70)
 *    @-mentions matched against `TOURISM_ACCOUNT_MAP` (e.g. `@visiticeland`).
 *
 * 8. **Bio-based** (`source: "bio_based"`, conf 0.60)
 *    Place patterns found in the creator's profile bio
 *    (e.g. "Based in 🇮🇸 Iceland").
 *
 * 9. **Comment vote triangulation** (`source: "comment_answer"`, conf 0.65)
 *    When multiple non-creator comments agree on the same place name in reply
 *    to a location question, the consensus answer is extracted.
 *
 * 10. **Music title places** (`source: "music_title"`, conf 0.50)
 *     Place names embedded in TikTok background music titles, cross-checked
 *     against `MUSIC_TITLE_PLACES`.
 *
 * ## Key lookup tables
 *
 * - `GENERIC_WORDS` — Set of common English words that are never valid place
 *   names (e.g. "here", "there", "home", "place"). Used to filter false
 *   positives from all text patterns.
 *
 * - `GEO_WORD_WHITELIST` — Set of words that look generic but ARE valid
 *   geographic terms and should never be filtered out (e.g. "jordan",
 *   "nice", "bath", "reading").
 *
 * - `KNOWN_GEO_HASHTAGS` — Map of lowercase hashtag → canonical place name
 *   for well-known travel hashtags (e.g. `"#iceland"` → `"Iceland"`).
 *   Used in Stage 6 of the hashtag pass.
 *
 * - `TOURISM_ACCOUNT_MAP` — Map of tourism/destination @usernames → place
 *   name (e.g. `"visiticeland"` → `"Iceland"`).
 *
 * - `MUSIC_TITLE_PLACES` — Set of known place names that appear in popular
 *   TikTok music titles and can be used as a weak location signal.
 *
 * ## Vote triangulation
 *
 * The comment vote system scans all non-creator comments for location-answer
 * patterns (e.g. "It's Bali!", "This is the Azores"). Each unique normalised
 * place name accumulates a vote count. If the top-voted name has ≥ 2 votes
 * and leads the second place by ≥ 2 votes, it is promoted as a
 * `"comment_answer"` candidate with confidence scaled by vote count.
 *
 * ## Exported symbols
 *
 * - `extractCandidates(signals)` — Main entry point; returns `CandidatePlace[]`
 *   sorted by confidence descending.
 * - `extractPlaceFromText(text)`  — NLP-lite single-string place extractor.
 * - `hashtagToPlace(tag)`         — Look up a hashtag in `KNOWN_GEO_HASHTAGS`.
 * - `KNOWN_GEO_HASHTAGS`          — The geo-hashtag lookup map (exported for
 *   use by the pipeline and tests).
 * - `CandidatePlace`              — The candidate place interface.
 * - `LocationSignals`             — The full signals bag interface.
 *
 * @module location/extractor
 */

// ─── Stage 1: Zero-Compute Text Extractor ────────────────────────────────────
// Extracts candidate place names from social media signals WITHOUT any API calls.
// Uses pattern matching, emoji detection, hashtag lookups, and heuristics only.
// Returns candidates sorted by confidence descending.

export interface CandidatePlace {
  name: string;
  raw: string; // original text snippet
  source:
    | "native_gps"
    | "anchor_location"
    | "pin_emoji"
    | "creator_reply"
    | "caption_explicit"
    | "geo_hashtag"
    | "bio_based"
    | "tagged_account"
    | "multi_hashtag"
    | "music_title"
    | "comment_answer";
  confidence: number; // 0.0 – 1.0
  countryHint?: string; // optional 2-letter ISO code or region string
}

export interface LocationSignals {
  caption: string;
  hashtags: string[];
  top_comments: string[];
  user_bio: string;
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
  author_username: string;
  thumbnail: string | null;
  platform: "tiktok" | "instagram";
  _creatorComments?: string[];
  _anchorLocations?: string[];
}

// ─── Generic word filter ──────────────────────────────────────────────────────

const GENERIC_WORDS = new Set([
  "here",
  "there",
  "home",
  "this",
  "that",
  "place",
  "spot",
  "location",
  "somewhere",
  "anywhere",
  "everywhere",
  "nowhere",
  "world",
  "earth",
  "amazing",
  "beautiful",
  "incredible",
  "gorgeous",
  "stunning",
  "perfect",
  "heaven",
  "paradise",
  "nature",
  "travel",
  "vacation",
  "holiday",
  "trip",
  "video",
  "content",
  "channel",
  "page",
  "post",
  "reel",
  "tiktok",
  "instagram",
  "yes",
  "no",
  "real",
  "true",
  "wow",
  "omg",
  "lol",
  "so",
  "lovely",
  "solitude",
  "peace",
  "calm",
  "vibe",
  "mood",
  "life",
  "dream",
  "moment",
  "memory",
  "feel",
  "love",
  "time",
  "day",
  "night",
  "morning",
  "evening",
  "summer",
  "winter",
  "spring",
  "autumn",
  "fall",
  "weekend",
  "explore",
  "adventure",
  "journey",
  "road",
  "view",
  "sky",
  "water",
  "people",
  "follow",
  "like",
  "share",
  "watch",
  "check",
  "link",
  "bio",
  "soon",
  "now",
  "today",
  "yesterday",
  "always",
  "never",
  "every",
  "just",
  "still",
  "even",
  "back",
  "away",
  "around",
  "must",
  "need",
  "want",
  "make",
  "take",
  "come",
  "give",
  "look",
  "know",
  "think",
  "good",
  "great",
  "best",
  "more",
  "much",
  "many",
  "some",
  "most",
]);

// ─── Country/city whitelist ────────────────────────────────────────────────────
// 300+ known geo words that can be matched from text

const GEO_WORD_WHITELIST = new Set([
  // Countries
  "afghanistan",
  "albania",
  "algeria",
  "andorra",
  "angola",
  "argentina",
  "armenia",
  "australia",
  "austria",
  "azerbaijan",
  "bahamas",
  "bahrain",
  "bangladesh",
  "barbados",
  "belarus",
  "belgium",
  "belize",
  "benin",
  "bhutan",
  "bolivia",
  "bosnia",
  "botswana",
  "brazil",
  "brunei",
  "bulgaria",
  "burkina",
  "burundi",
  "cambodia",
  "cameroon",
  "canada",
  "chile",
  "china",
  "colombia",
  "comoros",
  "congo",
  "croatia",
  "cuba",
  "cyprus",
  "czechia",
  "denmark",
  "djibouti",
  "dominica",
  "ecuador",
  "egypt",
  "ethiopia",
  "finland",
  "france",
  "gabon",
  "gambia",
  "georgia",
  "germany",
  "ghana",
  "greece",
  "grenada",
  "guatemala",
  "guinea",
  "guyana",
  "haiti",
  "honduras",
  "hungary",
  "iceland",
  "india",
  "indonesia",
  "iran",
  "iraq",
  "ireland",
  "israel",
  "italy",
  "jamaica",
  "japan",
  "jordan",
  "kazakhstan",
  "kenya",
  "kuwait",
  "kyrgyzstan",
  "laos",
  "latvia",
  "lebanon",
  "lesotho",
  "liberia",
  "libya",
  "liechtenstein",
  "lithuania",
  "luxembourg",
  "madagascar",
  "malawi",
  "malaysia",
  "maldives",
  "mali",
  "malta",
  "mauritania",
  "mauritius",
  "mexico",
  "moldova",
  "monaco",
  "mongolia",
  "montenegro",
  "morocco",
  "mozambique",
  "myanmar",
  "namibia",
  "nepal",
  "netherlands",
  "nicaragua",
  "niger",
  "nigeria",
  "norway",
  "oman",
  "pakistan",
  "panama",
  "paraguay",
  "peru",
  "philippines",
  "poland",
  "portugal",
  "qatar",
  "romania",
  "russia",
  "rwanda",
  "salvador",
  "samoa",
  "senegal",
  "serbia",
  "seychelles",
  "singapore",
  "slovakia",
  "slovenia",
  "somalia",
  "spain",
  "sudan",
  "suriname",
  "sweden",
  "switzerland",
  "syria",
  "taiwan",
  "tajikistan",
  "tanzania",
  "thailand",
  "togo",
  "trinidad",
  "tunisia",
  "turkey",
  "turkmenistan",
  "uganda",
  "ukraine",
  "emirates",
  "uruguay",
  "uzbekistan",
  "venezuela",
  "vietnam",
  "yemen",
  "zambia",
  "zimbabwe",
  // Major cities
  "amsterdam",
  "athens",
  "auckland",
  "bangkok",
  "barcelona",
  "beijing",
  "beirut",
  "berlin",
  "bogota",
  "brussels",
  "budapest",
  "buenos",
  "cairo",
  "cancun",
  "cape",
  "casablanca",
  "chicago",
  "copenhagen",
  "delhi",
  "doha",
  "dubai",
  "dublin",
  "edinburgh",
  "florence",
  "frankfurt",
  "geneva",
  "havana",
  "helsinki",
  "hong",
  "istanbul",
  "jakarta",
  "johannesburg",
  "karachi",
  "kathmandu",
  "kuala",
  "lagos",
  "lima",
  "lisbon",
  "london",
  "los",
  "lumpur",
  "lyon",
  "madrid",
  "manila",
  "marrakech",
  "melbourne",
  "miami",
  "milan",
  "montreal",
  "moscow",
  "mumbai",
  "munich",
  "nairobi",
  "oslo",
  "paris",
  "prague",
  "reykjavik",
  "riyadh",
  "rome",
  "santiago",
  "seoul",
  "shanghai",
  "singapore",
  "stockholm",
  "sydney",
  "taipei",
  "tehran",
  "tokyo",
  "toronto",
  "tunis",
  "vancouver",
  "vienna",
  "warsaw",
  "zurich",
  // US states
  "alabama",
  "alaska",
  "arizona",
  "arkansas",
  "california",
  "colorado",
  "connecticut",
  "delaware",
  "florida",
  "georgia",
  "hawaii",
  "idaho",
  "illinois",
  "indiana",
  "iowa",
  "kansas",
  "kentucky",
  "louisiana",
  "maine",
  "maryland",
  "massachusetts",
  "michigan",
  "minnesota",
  "mississippi",
  "missouri",
  "montana",
  "nebraska",
  "nevada",
  "hampshire",
  "jersey",
  "mexico",
  "york",
  "carolina",
  "dakota",
  "ohio",
  "oklahoma",
  "oregon",
  "pennsylvania",
  "rhode",
  "tennessee",
  "texas",
  "utah",
  "vermont",
  "virginia",
  "washington",
  "wisconsin",
  "wyoming",
  // Landmarks / natural features
  "alps",
  "amazon",
  "andes",
  "sahara",
  "himalayas",
  "kilimanjaro",
  "everest",
  "fuji",
  "vesuvius",
  "etna",
  "niagara",
  "victoria",
  "amazon",
  "nile",
  "ganges",
  "danube",
  "rhine",
  "seine",
  "thames",
  "mississippi",
  "colorado",
  "yellowstone",
  "yosemite",
  "patagonia",
  "serengeti",
  "sahara",
  "gobi",
  "atacama",
  "maldives",
  "bali",
  "cappadocia",
  "santorini",
  "amalfi",
  "positano",
  "cinque",
  "terre",
  "kotor",
  "dubrovnik",
  "hallstatt",
  "interlaken",
  "zanzibar",
  "mombasa",
  "tulum",
  "cancun",
  "bora",
  "phuket",
  "krabi",
  "palawan",
  "komodo",
  "lombok",
  "gili",
  "queenstown",
  "fiordland",
  "milford",
  "banff",
  "jasper",
  "grand",
  "canyon",
  "bryce",
  "zion",
  "arches",
  "glacier",
  "olympic",
  "acadia",
  "everglades",
  "shenandoah",
  "smoky",
  "multnomah",
  "crater",
  "columbia",
  "mckenzie",
  "deschutes",
  "rogue",
  "willamette",
  "cascades",
  "rainier",
  "hood",
  "angeles",
  "vegas",
  "francisco",
  "diego",
  "antonio",
  "jose",
  "portland",
  "seattle",
  "denver",
  "phoenix",
  "minneapolis",
  "nashville",
  "austin",
  "houston",
  "dallas",
  "atlanta",
  "boston",
  "philadelphia",
  "baltimore",
  "detroit",
  "memphis",
  "orleans",
  "charlotte",
  "raleigh",
  "richmond",
  "buffalo",
  // More European cities
  "venice",
  "naples",
  "palermo",
  "bologna",
  "florence",
  "genoa",
  "seville",
  "granada",
  "malaga",
  "valencia",
  "bilbao",
  "salzburg",
  "innsbruck",
  "bruges",
  "ghent",
  "antwerp",
  "rotterdam",
  "hague",
  "porto",
  "algarve",
  "sintra",
  "oporto",
  "wroclaw",
  "krakow",
  "gdansk",
  "vilnius",
  "tallinn",
  "riga",
  "chisinau",
  "tirana",
  "skopje",
  "podgorica",
  "pristina",
  "sarajevo",
  "mostar",
  "split",
  "zadar",
  "rovinj",
  "ohrid",
  "plovdiv",
  "varna",
  "tbilisi",
  "yerevan",
  "baku",
  "almaty",
  "tashkent",
  "ashgabat",
  "bishkek",
  // Asia
  "osaka",
  "hiroshima",
  "nara",
  "hokkaido",
  "okinawa",
  "sapporo",
  "kyoto",
  "nagoya",
  "yokohama",
  "busan",
  "incheon",
  "jeju",
  "taipei",
  "kaohsiung",
  "macau",
  "guangzhou",
  "shenzhen",
  "chengdu",
  "xian",
  "hangzhou",
  "suzhou",
  "guilin",
  "luoyang",
  "yangon",
  "mandalay",
  "bagan",
  "chiang",
  "pattaya",
  "samui",
  "koh",
  "hanoi",
  "saigon",
  "hochi",
  "danang",
  "hoi",
  "mekong",
  "siem",
  "reap",
  "phnom",
  "penh",
  "vientiane",
  "luang",
  "colombo",
  "kandy",
  "galle",
  "kathmandu",
  "pokhara",
  "lhasa",
  "kashmir",
  "shimla",
  "manali",
  "goa",
  "kerala",
  "rajasthan",
  "jaipur",
  "agra",
  "varanasi",
  "rishikesh",
  "darjeeling",
  "penang",
  "langkawi",
  "ipoh",
  "borneo",
  "sabah",
  "sarawak",
  "bohol",
  "cebu",
  "siargao",
  "boracay",
  "davao",
  // Middle East & Africa
  "petra",
  "wadi",
  "rum",
  "aqaba",
  "luxor",
  "aswan",
  "sharm",
  "hurghada",
  "marrakech",
  "fes",
  "chefchaouen",
  "essaouira",
  "tunis",
  "carthage",
  "djerba",
  "tripoli",
  "benghazi",
  "muscat",
  "salalah",
  "riyadh",
  "jeddah",
  "mecca",
  "medina",
  "abu",
  "dhabi",
  "sharjah",
  "fujairah",
  "nairobi",
  "mombasa",
  "kilimanjaro",
  "serengeti",
  "zanzibar",
  "dar",
  "salaam",
  "kigali",
  "kampala",
  "addis",
  "ababa",
  "accra",
  "dakar",
  "abidjan",
  "lagos",
  "abuja",
  "cape",
  "durban",
  "pretoria",
  "johannesburg",
  "victoria",
  "windhoek",
  "gaborone",
  "harare",
  "lusaka",
  "lilongwe",
  "antananarivo",
  "mauritius",
  // Americas
  "havana",
  "trinidad",
  "varadero",
  "cienfuegos",
  "santiago",
  "cartagena",
  "medellin",
  "bogota",
  "quito",
  "galapagos",
  "machu",
  "picchu",
  "cusco",
  "lima",
  "arequipa",
  "titicaca",
  "uyuni",
  "salar",
  "atacama",
  "valparaiso",
  "patagonia",
  "torres",
  "paine",
  "ushuaia",
  "bariloche",
  "mendoza",
  "iguazu",
  "pantanal",
  "manaus",
  "recife",
  "salvador",
  "florianopolis",
  "curitiba",
  "foz",
  "buzzios",
  "paraty",
  "oaxaca",
  "guadalajara",
  "monterrey",
  "merida",
  "puebla",
  "guanajuato",
  "tulum",
  "playa",
  "del",
  "carmen",
  "bacalar",
  "antigua",
  "tikal",
  "belize",
  "roatan",
  "monteverde",
  "tortuguero",
  "manuel",
  "antonio",
  "arenal",
  "tamarindo",
  // Portuguese islands & Atlantic
  "azores",
  "madeira",
  "flores",
  "faial",
  "pico",
  "terceira",
  "sao miguel",
  "corvo",
  "graciosa",
  "santa maria",
  // Other islands & archipelagos
  "canarias",
  "canary",
  "tenerife",
  "lanzarote",
  "fuerteventura",
  "gran canaria",
  "ibiza",
  "mallorca",
  "menorca",
  "sardinia",
  "sicily",
  "corsica",
  "crete",
  "mykonos",
  "santorini",
  "rhodes",
  "corfu",
  "capri",
  "ischia",
  "elba",
  "malta",
  "gozo",
  "reunion",
  "la reunion",
  "mayotte",
  "guadeloupe",
  "martinique",
  "saint lucia",
  "barbados",
  "antigua",
  "tobago",
  // Pacific
  "honolulu",
  "maui",
  "kauai",
  "lanai",
  "molokai",
  "hilo",
  "waikiki",
  "napali",
  "waimea",
  "haleakala",
  "waianae",
  "fiji",
  "nadi",
  "suva",
  "vanuatu",
  "tahiti",
  "bora",
  "moorea",
  "tonga",
  "samoa",
  "palau",
  "micronesia",
]);

// ─── 500+ Known geo-hashtag map ───────────────────────────────────────────────

export const KNOWN_GEO_HASHTAGS: Record<string, string> = {
  // ── Oregon / Pacific Northwest ───────────────────────────────────────────
  mckenzieriver: "McKenzie River, Oregon",
  mckenzierivertrail: "McKenzie River Trail, Oregon",
  oregonriver: "Oregon River",
  oregontrail: "Oregon Trail",
  oregon: "Oregon, USA",
  portland: "Portland, Oregon",
  portlandoregon: "Portland, Oregon",
  pdx: "Portland, Oregon",
  multnomahfalls: "Multnomah Falls, Oregon",
  craterlake: "Crater Lake, Oregon",
  craterlakenationalpark: "Crater Lake National Park, Oregon",
  columbiarivergorge: "Columbia River Gorge, Oregon",
  columbiagorge: "Columbia River Gorge, Oregon",
  deshuteriver: "Deschutes River, Oregon",
  deschutesriver: "Deschutes River, Oregon",
  rogueriver: "Rogue River, Oregon",
  willamette: "Willamette Valley, Oregon",
  willamettevalley: "Willamette Valley, Oregon",
  mthood: "Mount Hood, Oregon",
  mounthood: "Mount Hood, Oregon",
  bendoregon: "Bend, Oregon",
  bend: "Bend, Oregon",
  ashlandoregon: "Ashland, Oregon",
  eugeneoregon: "Eugene, Oregon",
  salemor: "Salem, Oregon",
  seattle: "Seattle, Washington",
  seattlewa: "Seattle, Washington",
  washington: "Washington, USA",
  rainier: "Mount Rainier, Washington",
  mtrainier: "Mount Rainier, Washington",
  mountrainier: "Mount Rainier National Park",
  olympicnationalpark: "Olympic National Park, Washington",
  northcascades: "North Cascades, Washington",
  snoqualmie: "Snoqualmie Falls, Washington",
  puget: "Puget Sound, Washington",
  // ── California ───────────────────────────────────────────────────────────
  california: "California, USA",
  losangeles: "Los Angeles, California",
  la: "Los Angeles, California",
  sanfrancisco: "San Francisco, California",
  sf: "San Francisco, California",
  sandiego: "San Diego, California",
  sacramento: "Sacramento, California",
  yosemite: "Yosemite National Park, California",
  yosemitenationalpark: "Yosemite National Park, California",
  bigsurcalifornia: "Big Sur, California",
  bigsur: "Big Sur, California",
  napa: "Napa Valley, California",
  napavalley: "Napa Valley, California",
  muirwoods: "Muir Woods, California",
  laketahoe: "Lake Tahoe, California",
  tahoe: "Lake Tahoe",
  palmsprings: "Palm Springs, California",
  joshuatree: "Joshua Tree National Park",
  joshuatreenationalpark: "Joshua Tree National Park, California",
  deathvalley: "Death Valley National Park",
  sequoia: "Sequoia National Park",
  // ── Southwest USA ──────────────────────────────────────────────────────
  grandcanyon: "Grand Canyon, Arizona",
  grandcanyonnationalpark: "Grand Canyon National Park",
  arizona: "Arizona, USA",
  sedona: "Sedona, Arizona",
  phoenix: "Phoenix, Arizona",
  tucson: "Tucson, Arizona",
  zion: "Zion National Park, Utah",
  zionnationalpark: "Zion National Park, Utah",
  utah: "Utah, USA",
  bryce: "Bryce Canyon, Utah",
  brycecanyonnationalpark: "Bryce Canyon National Park",
  archesnationalpark: "Arches National Park, Utah",
  arches: "Arches National Park, Utah",
  canyonlands: "Canyonlands National Park",
  moab: "Moab, Utah",
  slc: "Salt Lake City, Utah",
  saltlakecity: "Salt Lake City, Utah",
  nevada: "Nevada, USA",
  lasvegas: "Las Vegas, Nevada",
  vegas: "Las Vegas, Nevada",
  colorado: "Colorado, USA",
  denver: "Denver, Colorado",
  aspen: "Aspen, Colorado",
  boulder: "Boulder, Colorado",
  rockymountains: "Rocky Mountains",
  rockymountainnationalpark: "Rocky Mountain National Park",
  // ── Southeast / East USA ─────────────────────────────────────────────
  florida: "Florida, USA",
  miami: "Miami, Florida",
  orlando: "Orlando, Florida",
  miamibeach: "Miami Beach, Florida",
  keywest: "Key West, Florida",
  everglades: "Everglades National Park",
  newyork: "New York City, USA",
  nyc: "New York City, USA",
  manhattan: "Manhattan, New York",
  brooklyn: "Brooklyn, New York",
  boston: "Boston, Massachusetts",
  chicago: "Chicago, Illinois",
  nashville: "Nashville, Tennessee",
  austin: "Austin, Texas",
  texas: "Texas, USA",
  houston: "Houston, Texas",
  neworleans: "New Orleans, Louisiana",
  nola: "New Orleans, Louisiana",
  atlanta: "Atlanta, Georgia",
  charleston: "Charleston, South Carolina",
  savannah: "Savannah, Georgia",
  asheville: "Asheville, North Carolina",
  smoky: "Great Smoky Mountains National Park",
  greatsmokies: "Great Smoky Mountains National Park",
  shenandoah: "Shenandoah National Park",
  acadia: "Acadia National Park, Maine",
  // ── Canada ───────────────────────────────────────────────────────────
  canada: "Canada",
  banff: "Banff, Canada",
  banffnationalpark: "Banff National Park, Canada",
  jasper: "Jasper National Park, Canada",
  lakelouise: "Lake Louise, Alberta",
  jasperalberta: "Jasper, Alberta",
  vancouver: "Vancouver, Canada",
  victoria: "Victoria, British Columbia",
  whistler: "Whistler, British Columbia",
  toronto: "Toronto, Canada",
  montreal: "Montreal, Canada",
  quebec: "Quebec City, Canada",
  niagara: "Niagara Falls, Canada",
  niagarafalls: "Niagara Falls, Ontario",
  // ── Iceland ──────────────────────────────────────────────────────────
  iceland: "Iceland",
  reykjavik: "Reykjavik, Iceland",
  bluelagoon: "Blue Lagoon, Iceland",
  blulagoon: "Blue Lagoon, Iceland",
  blalaon: "Blue Lagoon, Iceland",
  goldenring: "Golden Circle, Iceland",
  goldencircle: "Golden Circle, Iceland",
  jokulsarlon: "Jökulsárlón, Iceland",
  skogafoss: "Skógafoss, Iceland",
  seljalandsfoss: "Seljalandsfoss, Iceland",
  geysir: "Geysir, Iceland",
  kirkjufell: "Kirkjufell, Iceland",
  reynisfjara: "Reynisfjara Black Sand Beach, Iceland",
  // ── Norway ───────────────────────────────────────────────────────────
  norway: "Norway",
  oslo: "Oslo, Norway",
  bergen: "Bergen, Norway",
  fjords: "Norwegian Fjords",
  geiranger: "Geirangerfjord, Norway",
  trolltunga: "Trolltunga, Norway",
  preikestolen: "Preikestolen, Norway",
  lofoten: "Lofoten Islands, Norway",
  aurora: "Northern Lights",
  northernlights: "Northern Lights, Norway",
  // ── Scandinavia ───────────────────────────────────────────────────────
  sweden: "Sweden",
  stockholm: "Stockholm, Sweden",
  gothenburg: "Gothenburg, Sweden",
  denmark: "Denmark",
  copenhagen: "Copenhagen, Denmark",
  finland: "Finland",
  helsinki: "Helsinki, Finland",
  lapland: "Lapland, Finland",
  // ── UK & Ireland ─────────────────────────────────────────────────────
  london: "London, UK",
  edinburgh: "Edinburgh, Scotland",
  scotland: "Scotland",
  highlands: "Scottish Highlands",
  glasgowscotland: "Glasgow, Scotland",
  wales: "Wales, UK",
  cardiff: "Cardiff, Wales",
  ireland: "Ireland",
  dublin: "Dublin, Ireland",
  cliffs: "Cliffs of Moher, Ireland",
  cliffsofmoher: "Cliffs of Moher, Ireland",
  galway: "Galway, Ireland",
  // ── France ───────────────────────────────────────────────────────────
  france: "France",
  paris: "Paris, France",
  eiffeltower: "Eiffel Tower, Paris",
  frenchriviera: "French Riviera",
  nicefrancec: "Nice, France",
  nice: "Nice, France",
  cannes: "Cannes, France",
  monaco: "Monaco",
  lyon: "Lyon, France",
  bordeaux: "Bordeaux, France",
  provence: "Provence, France",
  alsace: "Alsace, France",
  montblanc: "Mont Blanc, France",
  versailles: "Palace of Versailles, France",
  // ── Spain ────────────────────────────────────────────────────────────
  spain: "Spain",
  barcelona: "Barcelona, Spain",
  madrid: "Madrid, Spain",
  seville: "Seville, Spain",
  granada: "Granada, Spain",
  alhambra: "Alhambra, Spain",
  sagradafamilia: "Sagrada Família, Barcelona",
  ibiza: "Ibiza, Spain",
  mallorca: "Mallorca, Spain",
  tenerife: "Tenerife, Spain",
  malaga: "Málaga, Spain",
  valencia: "Valencia, Spain",
  bilbao: "Bilbao, Spain",
  // ── Portugal ─────────────────────────────────────────────────────────
  portugal: "Portugal",
  lisbon: "Lisbon, Portugal",
  porto: "Porto, Portugal",
  oporto: "Porto, Portugal",
  sintra: "Sintra, Portugal",
  algarve: "Algarve, Portugal",
  azores: "Azores, Portugal",
  madeira: "Madeira, Portugal",
  // ── Italy ────────────────────────────────────────────────────────────
  italy: "Italy",
  rome: "Rome, Italy",
  colosseum: "Colosseum, Rome",
  vatican: "Vatican City",
  venice: "Venice, Italy",
  florence: "Florence, Italy",
  milan: "Milan, Italy",
  naples: "Naples, Italy",
  amalficoast: "Amalfi Coast, Italy",
  amalfi: "Amalfi, Italy",
  positano: "Positano, Italy",
  cinqueterre: "Cinque Terre, Italy",
  cinquerrre: "Cinque Terre, Italy",
  ravello: "Ravello, Italy",
  sicily: "Sicily, Italy",
  sardinia: "Sardinia, Italy",
  dolomites: "Dolomites, Italy",
  tuscany: "Tuscany, Italy",
  // ── Greece ───────────────────────────────────────────────────────────
  greece: "Greece",
  santorini: "Santorini, Greece",
  mykonos: "Mykonos, Greece",
  athens: "Athens, Greece",
  acropolis: "Acropolis, Athens",
  crete: "Crete, Greece",
  corfu: "Corfu, Greece",
  rhodes: "Rhodes, Greece",
  meteora: "Meteora, Greece",
  // ── Eastern Europe ────────────────────────────────────────────────────
  prague: "Prague, Czech Republic",
  czechrepublic: "Czech Republic",
  budapest: "Budapest, Hungary",
  hungary: "Hungary",
  vienna: "Vienna, Austria",
  austria: "Austria",
  hallstatt: "Hallstatt, Austria",
  salzburg: "Salzburg, Austria",
  innsbruck: "Innsbruck, Austria",
  switzerland: "Switzerland",
  zurich: "Zurich, Switzerland",
  interlaken: "Interlaken, Switzerland",
  lucerne: "Lucerne, Switzerland",
  grindelwald: "Grindelwald, Switzerland",
  jungfrau: "Jungfrau, Switzerland",
  zermatt: "Zermatt, Switzerland",
  matterhorn: "Matterhorn, Switzerland",
  bern: "Bern, Switzerland",
  geneva: "Geneva, Switzerland",
  poland: "Poland",
  warsaw: "Warsaw, Poland",
  krakow: "Krakow, Poland",
  wroclaw: "Wrocław, Poland",
  gdansk: "Gdańsk, Poland",
  croatia: "Croatia",
  dubrovnik: "Dubrovnik, Croatia",
  split: "Split, Croatia",
  hvar: "Hvar, Croatia",
  rovinj: "Rovinj, Croatia",
  plitvice: "Plitvice Lakes, Croatia",
  plitvicka: "Plitvice Lakes, Croatia",
  slovenia: "Slovenia",
  bledlake: "Lake Bled, Slovenia",
  lakebled: "Lake Bled, Slovenia",
  bled: "Lake Bled, Slovenia",
  ljubljana: "Ljubljana, Slovenia",
  montenegro: "Montenegro",
  kotor: "Kotor, Montenegro",
  budva: "Budva, Montenegro",
  albania: "Albania",
  georgia: "Georgia",
  tbilisi: "Tbilisi, Georgia",
  kazbegi: "Kazbegi, Georgia",
  // ── Turkey ───────────────────────────────────────────────────────────
  turkey: "Turkey",
  istanbul: "Istanbul, Turkey",
  cappadocia: "Cappadocia, Turkey",
  pamukkale: "Pamukkale, Turkey",
  ephesus: "Ephesus, Turkey",
  bodrum: "Bodrum, Turkey",
  antalya: "Antalya, Turkey",
  // ── Middle East ──────────────────────────────────────────────────────
  dubai: "Dubai, UAE",
  abudhabi: "Abu Dhabi, UAE",
  uae: "UAE",
  burjkhalifa: "Burj Khalifa, Dubai",
  jordan: "Jordan",
  petra: "Petra, Jordan",
  wadinum: "Wadi Rum, Jordan",
  deadSea: "Dead Sea",
  deadsea: "Dead Sea",
  israel: "Israel",
  jerusalem: "Jerusalem, Israel",
  telaviv: "Tel Aviv, Israel",
  morocco: "Morocco",
  marrakech: "Marrakech, Morocco",
  fes: "Fes, Morocco",
  chefchaouen: "Chefchaouen, Morocco",
  sahara: "Sahara Desert",
  egypt: "Egypt",
  cairo: "Cairo, Egypt",
  pyramids: "Pyramids of Giza, Egypt",
  giza: "Giza, Egypt",
  luxor: "Luxor, Egypt",
  // ── Africa ───────────────────────────────────────────────────────────
  kenya: "Kenya",
  nairobi: "Nairobi, Kenya",
  maasaimara: "Maasai Mara, Kenya",
  masaimara: "Maasai Mara, Kenya",
  tanzania: "Tanzania",
  serengeti: "Serengeti, Tanzania",
  kilimanjaro: "Mount Kilimanjaro, Tanzania",
  zanzibar: "Zanzibar, Tanzania",
  southafrica: "South Africa",
  capetown: "Cape Town, South Africa",
  capetownsa: "Cape Town, South Africa",
  johannesburg: "Johannesburg, South Africa",
  tableumountain: "Table Mountain, South Africa",
  tablemountain: "Table Mountain, Cape Town",
  madagascar: "Madagascar",
  mauritius: "Mauritius",
  seychelles: "Seychelles",
  // ── Japan ────────────────────────────────────────────────────────────
  japan: "Japan",
  tokyo: "Tokyo, Japan",
  kyoto: "Kyoto, Japan",
  osaka: "Osaka, Japan",
  hiroshima: "Hiroshima, Japan",
  nara: "Nara, Japan",
  sapporo: "Sapporo, Japan",
  hokkaido: "Hokkaido, Japan",
  okinawa: "Okinawa, Japan",
  fujisan: "Mount Fuji, Japan",
  mtfuji: "Mount Fuji, Japan",
  mountfuji: "Mount Fuji, Japan",
  fushimiinari: "Fushimi Inari, Kyoto",
  arashiyama: "Arashiyama Bamboo Grove, Kyoto",
  // ── Korea ────────────────────────────────────────────────────────────
  southkorea: "South Korea",
  korea: "South Korea",
  seoul: "Seoul, South Korea",
  busan: "Busan, South Korea",
  jeju: "Jeju Island, South Korea",
  // ── Southeast Asia ────────────────────────────────────────────────────
  bali: "Bali, Indonesia",
  ubud: "Ubud, Bali",
  lombok: "Lombok, Indonesia",
  komodo: "Komodo Island, Indonesia",
  raja: "Raja Ampat, Indonesia",
  rajaampa: "Raja Ampat, Indonesia",
  rajampat: "Raja Ampat, Indonesia",
  indonesia: "Indonesia",
  thailand: "Thailand",
  bangkok: "Bangkok, Thailand",
  chiangmai: "Chiang Mai, Thailand",
  phuket: "Phuket, Thailand",
  kohsamui: "Koh Samui, Thailand",
  kohlanta: "Koh Lanta, Thailand",
  kohphiphi: "Koh Phi Phi, Thailand",
  phiphiisland: "Ko Phi Phi, Thailand",
  krabi: "Krabi, Thailand",
  vietnam: "Vietnam",
  hanoi: "Hanoi, Vietnam",
  hcmc: "Ho Chi Minh City, Vietnam",
  hochiminh: "Ho Chi Minh City, Vietnam",
  hoidanancity: "Hoi An, Vietnam",
  hoian: "Hoi An, Vietnam",
  halong: "Ha Long Bay, Vietnam",
  halongbay: "Ha Long Bay, Vietnam",
  sapa: "Sapa, Vietnam",
  danang: "Da Nang, Vietnam",
  cambodia: "Cambodia",
  angkorwat: "Angkor Wat, Cambodia",
  siemreap: "Siem Reap, Cambodia",
  phompenh: "Phnom Penh, Cambodia",
  malaysia: "Malaysia",
  kualalumpur: "Kuala Lumpur, Malaysia",
  penang: "Penang, Malaysia",
  langkawi: "Langkawi, Malaysia",
  borneo: "Borneo",
  singapore: "Singapore",
  philippines: "Philippines",
  manila: "Manila, Philippines",
  palawan: "Palawan, Philippines",
  boracay: "Boracay, Philippines",
  siargao: "Siargao, Philippines",
  cebu: "Cebu, Philippines",
  myanmar: "Myanmar",
  bagan: "Bagan, Myanmar",
  yangon: "Yangon, Myanmar",
  laos: "Laos",
  luangprabang: "Luang Prabang, Laos",
  // ── India / Nepal / Sri Lanka ─────────────────────────────────────────
  india: "India",
  delhi: "Delhi, India",
  newdelhi: "New Delhi, India",
  mumbai: "Mumbai, India",
  goa: "Goa, India",
  jaipur: "Jaipur, India",
  agra: "Agra, India",
  tajmahal: "Taj Mahal, Agra",
  varanasi: "Varanasi, India",
  kerala: "Kerala, India",
  rishikesh: "Rishikesh, India",
  darjeeling: "Darjeeling, India",
  kashmir: "Kashmir, India",
  nepal: "Nepal",
  kathmandu: "Kathmandu, Nepal",
  everest: "Mount Everest, Nepal",
  pokhara: "Pokhara, Nepal",
  srilanka: "Sri Lanka",
  colombo: "Colombo, Sri Lanka",
  kandy: "Kandy, Sri Lanka",
  // ── Australia / New Zealand ───────────────────────────────────────────
  australia: "Australia",
  sydney: "Sydney, Australia",
  melbourne: "Melbourne, Australia",
  brisbane: "Brisbane, Australia",
  perth: "Perth, Australia",
  cairns: "Cairns, Australia",
  goldcoast: "Gold Coast, Australia",
  greatbarrierreef: "Great Barrier Reef, Australia",
  uluru: "Uluru, Australia",
  newzealand: "New Zealand",
  queenstown: "Queenstown, New Zealand",
  auckland: "Auckland, New Zealand",
  milfordsound: "Milford Sound, New Zealand",
  // ── Americas ─────────────────────────────────────────────────────────
  peru: "Peru",
  machupicchu: "Machu Picchu, Peru",
  machu: "Machu Picchu, Peru",
  cusco: "Cusco, Peru",
  lima: "Lima, Peru",
  laketiticaca: "Lake Titicaca",
  titicaca: "Lake Titicaca",
  colombia: "Colombia",
  cartagena: "Cartagena, Colombia",
  medellin: "Medellín, Colombia",
  bogota: "Bogotá, Colombia",
  brazil: "Brazil",
  riodejaneiro: "Rio de Janeiro, Brazil",
  rio: "Rio de Janeiro, Brazil",
  saopaulo: "São Paulo, Brazil",
  iguazu: "Iguazú Falls",
  iguassu: "Iguaçu Falls, Brazil",
  amazon: "Amazon Rainforest",
  argentina: "Argentina",
  buenosaires: "Buenos Aires, Argentina",
  patagonia: "Patagonia",
  torresdelpaine: "Torres del Paine, Chile",
  chile: "Chile",
  santiagocc: "Santiago, Chile",
  atacama: "Atacama Desert, Chile",
  mexico: "Mexico",
  mexicocity: "Mexico City, Mexico",
  cdmx: "Mexico City, Mexico",
  guadalajara: "Guadalajara, Mexico",
  tulum: "Tulum, Mexico",
  cancun: "Cancún, Mexico",
  oaxaca: "Oaxaca, Mexico",
  playadelcarmen: "Playa del Carmen, Mexico",
  bacalar: "Bacalar, Mexico",
  guanajuato: "Guanajuato, Mexico",
  // ── Caribbean / Pacific ───────────────────────────────────────────────
  hawaii: "Hawaii, USA",
  maui: "Maui, Hawaii",
  oahu: "Oahu, Hawaii",
  kauai: "Kauai, Hawaii",
  honolulu: "Honolulu, Hawaii",
  bigisland: "Big Island, Hawaii",
  bora: "Bora Bora, French Polynesia",
  borabora: "Bora Bora, French Polynesia",
  tahiti: "Tahiti, French Polynesia",
  maldives: "Maldives",
  maldive: "Maldives",
  cuba: "Cuba",
  havana: "Havana, Cuba",
  jamaica: "Jamaica",
  // ── Natural features & parks ──────────────────────────────────────────
  yellowstone: "Yellowstone National Park",
  yellowstonenationalpark: "Yellowstone National Park",
  grandtetons: "Grand Teton National Park",
  grandteton: "Grand Teton National Park",
  glacier: "Glacier National Park",
  glaciernationalpark: "Glacier National Park, Montana",
  antelope: "Antelope Canyon, Arizona",
  antelopecanyon: "Antelope Canyon, Arizona",
  horseshoe: "Horseshoe Bend, Arizona",
  horseshoebend: "Horseshoe Bend, Arizona",
  monument: "Monument Valley",
  monumentvalley: "Monument Valley, Arizona",
  greatwallofchina: "Great Wall of China",
  greatwall: "Great Wall of China",
  amazonfalls: "Amazon Falls",
  angelsfalls: "Angel Falls, Venezuela",
  victoriafalls: "Victoria Falls, Zimbabwe",
  iguazufalls: "Iguazú Falls, Argentina",
};

// ─── Music title → place mapping (commonly used song-place pairs) ────────────

const MUSIC_TITLE_PLACES: Record<string, string> = {
  "viva las vegas": "Las Vegas, Nevada",
  "new york new york": "New York City",
  "new york state of mind": "New York City",
  "california dreamin": "California",
  "hotel california": "California",
  "streets of philadelphia": "Philadelphia",
  "london calling": "London",
  "baker street": "London",
  waterloo: "Waterloo, Belgium",
  vienna: "Vienna, Austria",
  rio: "Rio de Janeiro, Brazil",
  barcelona: "Barcelona, Spain",
  ibiza: "Ibiza, Spain",
  havana: "Havana, Cuba",
  istanbul: "Istanbul, Turkey",
  mumbai: "Mumbai, India",
  tokyo: "Tokyo, Japan",
  kyoto: "Kyoto, Japan",
  amsterdam: "Amsterdam, Netherlands",
  paris: "Paris, France",
  "hello from the other side": "",
  "born in the usa": "USA",
  "georgia on my mind": "Georgia, USA",
  "sweet home alabama": "Alabama, USA",
  "tennessee whiskey": "Tennessee, USA",
  "take me home country roads": "West Virginia, USA",
  shallow: "",
  africa: "Africa",
  mexico: "Mexico",
  jamaica: "Jamaica",
};

// ─── Tagged tourism accounts → place mapping ──────────────────────────────────

const TOURISM_ACCOUNT_MAP: Record<string, string> = {
  visiticeland: "Iceland",
  visitoreogn: "Oregon",
  visitoregon: "Oregon",
  iamsterdam: "Amsterdam, Netherlands",
  visitdubai: "Dubai, UAE",
  visitjapan: "Japan",
  visitkorea: "South Korea",
  visitmaldives: "Maldives",
  visitsingapore: "Singapore",
  visitthailand: "Thailand",
  tourismaustralia: "Australia",
  visitscotland: "Scotland",
  visitwales: "Wales",
  visitireland: "Ireland",
  visitengland: "England",
  visitnorway: "Norway",
  visitsweden: "Sweden",
  visitdenmark: "Denmark",
  visitfinland: "Finland",
  visitswitzeland: "Switzerland",
  visitswitzerland: "Switzerland",
  visitmadrid: "Madrid, Spain",
  visitbarcelona: "Barcelona, Spain",
  visitportugal: "Portugal",
  visitgreece: "Greece",
  visitsantorini: "Santorini, Greece",
  visitcroatia: "Croatia",
  visitdubrovnik: "Dubrovnik, Croatia",
  visitczech: "Czech Republic",
  visitbudapest: "Budapest, Hungary",
  visitparis: "Paris, France",
  visitlondon: "London, UK",
  visitrome: "Rome, Italy",
  visitmilan: "Milan, Italy",
  discoverportland: "Portland, Oregon",
  traveloregon: "Oregon",
  visitcalifornia: "California",
  gocalif: "California",
  visitflorida: "Florida",
  visitmontana: "Montana",
  visitutah: "Utah",
  visitcolorado: "Colorado",
  yellowstonenps: "Yellowstone National Park",
  nps: "USA National Park",
  yosemitenps: "Yosemite National Park",
  visitmaroc: "Morocco",
  visitmorroco: "Morocco",
  visitmorocco: "Morocco",
  lovemarrakech: "Marrakech, Morocco",
  visitegypt: "Egypt",
  visitkenya: "Kenya",
  visittanzania: "Tanzania",
  visitsouthafrica: "South Africa",
  visitmauritius: "Mauritius",
  visitbali: "Bali, Indonesia",
  visitindonesia: "Indonesia",
  visitseychelles: "Seychelles",
  visitnewzealand: "New Zealand",
  lovenz: "New Zealand",
  visitcanada: "Canada",
  explorecanada: "Canada",
  visitbc: "British Columbia, Canada",
  visitbanff: "Banff, Canada",
  visitvietnam: "Vietnam",
  visitindia: "India",
  incredibleindia: "India",
  visitnepal: "Nepal",
  visitmyanmar: "Myanmar",
  visitphilippines: "Philippines",
  visitmalaysia: "Malaysia",
  traveljamaica: "Jamaica",
  goperu: "Peru",
  visitperu: "Peru",
  visitcolombia: "Colombia",
  visitbrazil: "Brazil",
  visitargentina: "Argentina",
  discoveryargentina: "Argentina",
  visitmexicocity: "Mexico City",
  visitmexico: "Mexico",
  godubai: "Dubai, UAE",
  visitabudhabi: "Abu Dhabi, UAE",
  visitjordan: "Jordan",
};

// ─── extractPlaceFromText ─────────────────────────────────────────────────────
// Core NLP-lite place extractor. Applies cascaded regex patterns to any text.

export function extractPlaceFromText(text: string): string | null {
  if (!text || text.trim().length < 3) return null;
  const t = text.trim();

  // 1. Pin emoji — highest signal
  const pinMatch = t.match(/[📍📌🌍🌎🌏]\s*([\w\s,'\-\.]{3,60})/u);
  if (pinMatch?.[1]) {
    const candidate = pinMatch[1].trim().replace(/[.,!?\n]+$/, "");
    if (candidate.length >= 3 && !GENERIC_WORDS.has(candidate.toLowerCase()))
      return candidate;
  }

  // 2. Definite article + natural/built feature noun
  const naturalMatch = t.match(
    /\bthe\s+([A-Z][a-zA-Z\s]{2,40}(?:river|lake|falls|waterfall|canyon|valley|mountain|mountains|beach|bay|gorge|coast|forest|trail|park|glacier|island|cave|lagoon|spring|creek|bridge|castle|palace|mosque|temple|cathedral|museum|market|square|street|village|town|city|harbor|harbour|peninsula|volcano|plateau|desert|reef|fjord|sound|strait|inlet|peak|summit|range|cliff|dunes|oasis))\b/i,
  );
  if (naturalMatch?.[1]) {
    const candidate = naturalMatch[1].trim();
    if (candidate.length >= 3 && !GENERIC_WORDS.has(candidate.toLowerCase()))
      return candidate;
  }

  // 3. "This is X" — must come FIRST and stop at sentence boundaries
  // e.g. "This is Flores in the Azores. i used to live there." → "Flores in the Azores"
  const thisIsMatch = t.match(
    /\bthis\s+is\s+(?:the\s+)?([A-Z][a-zA-Z\s,'']{3,60}?)(?=[.!?\n]|$|\si\s|\sand\s|\sbut\s)/i,
  );
  if (thisIsMatch?.[1]) {
    const candidate = thisIsMatch[1]
      .trim()
      .replace(/[.,!?]+$/, "")
      .trim();
    if (candidate.length >= 3 && !GENERIC_WORDS.has(candidate.toLowerCase()))
      return candidate;
  }

  // 3b. "It's / That's" + place — only fires if sentence starts with it (not mid-sentence)
  // e.g. "It's the Azores" — but NOT matching mid-sentence "it's" in long text
  const itsMatch = t.match(
    /^(?:it[''']?s|that[''']?s)\s+(?:the\s+)?([A-Z][a-zA-Z\s,'']{3,50}?)(?=[.!?\n]|$|\s[a-z])/,
  );
  if (itsMatch?.[1]) {
    const candidate = itsMatch[1]
      .trim()
      .replace(/[.,!?]+$/, "")
      .trim();
    if (candidate.length >= 3 && !GENERIC_WORDS.has(candidate.toLowerCase()))
      return candidate;
  }

  // 4. Located / filmed / shot / captured / visiting + at/in
  const locatedMatch = t.match(
    /\b(?:located?|filmed?|shot|recorded?|captured?|visiting|visited)\s+(?:at|in)\s+(?:the\s+)?([A-Z][a-zA-Z\s,'']{3,60})/i,
  );
  if (locatedMatch?.[1]) {
    const candidate = locatedMatch[1].trim().replace(/[.,!?]+$/, "");
    if (candidate.length >= 3 && !GENERIC_WORDS.has(candidate.toLowerCase()))
      return candidate;
  }

  // 5. "in X" or "at X" with capitalised multi-word proper noun
  // Allow lowercase connector words: "in the Azores", "in the UK"
  const inAtMatch = t.match(
    /\b(?:in|at)\s+(?:the\s+)?([A-Z][a-zA-Z]+(?:(?:\s+(?:the|of|de|du|la|le|les|el|los|las|di|da|in|and)\s+)?[A-Z][a-zA-Z]+){0,4})/,
  );
  if (inAtMatch?.[1]) {
    const candidate = inAtMatch[1]
      .trim()
      .replace(/[.,!?]+$/, "")
      .trim();
    if (
      candidate.length >= 4 &&
      !GENERIC_WORDS.has(candidate.toLowerCase()) &&
      !/^(The|This|That|My|Our|Your|It|He|She|They|We|You|I)\b/.test(candidate)
    )
      return candidate;
  }

  // 6. Short 1-5 word title-case line (no generic filler words)
  const words = t.trim().split(/\s+/);
  if (words.length >= 1 && words.length <= 5) {
    const allTitleCase = words.every(
      (w) =>
        /^[A-Z]/.test(w) ||
        /^(of|the|in|at|de|du|la|le|les|el|los|las|und|von|van|al|di|da|do|delle|degli|del|della)\b/i.test(
          w,
        ),
    );
    const hasGeneric = words.some((w) =>
      GENERIC_WORDS.has(w.toLowerCase().replace(/[^a-z]/g, "")),
    );
    const candidate = t.replace(/[.,!?]+$/, "").trim();
    if (
      allTitleCase &&
      !hasGeneric &&
      candidate.length >= 4 &&
      candidate.length <= 60
    ) {
      return candidate;
    }
  }

  // 7. Geo whitelist word match (case-insensitive)
  const lower = t.toLowerCase();
  for (const geoWord of GEO_WORD_WHITELIST) {
    // Use word boundary matching
    const re = new RegExp(`\\b${geoWord}\\b`, "i");
    if (re.test(lower)) {
      // Find contextual phrase around this word
      const wordMatch = t.match(
        new RegExp(
          `([A-Z][^.!?\\n]{0,40}\\b${geoWord}\\b[^.!?\\n]{0,30})`,
          "i",
        ),
      );
      if (wordMatch?.[1]) {
        const candidate = wordMatch[1]
          .trim()
          .replace(/[.,!?]+$/, "")
          .trim();
        if (candidate.length >= 3 && candidate.length <= 80) return candidate;
      }
      // Just return the geo word title-cased
      return geoWord.charAt(0).toUpperCase() + geoWord.slice(1);
    }
  }

  return null;
}

// ─── hashtagToPlace ───────────────────────────────────────────────────────────

export function hashtagToPlace(tag: string): string | null {
  if (!tag) return null;
  const lower = tag.toLowerCase().replace(/^#/, "");

  // Skip generic travel/lifestyle tags
  if (
    /^(travel|explore|adventure|nature|outdoor|hike|hiking|photography|photo|video|content|viral|fyp|foryou|foryoupage|trending|beautiful|amazing|stunning|scenery|landscape|wanderlust|instatravel|travelgram|travelphotography|travelblogger|traveladdict|nomad|backpack|worldtravel|digitalnomad|traveller|traveler|roadtrip|vacation|holiday|trip|journey|adventure|sunset|sunrise|mountains|beach|ocean|forest|wildlife|nature)/.test(
      lower,
    ) ||
    /travel$|trip$|life$|vibes?$|mood$|goals?$|gram$|tok$|love$|fan$|official$/.test(
      lower,
    )
  ) {
    return null;
  }

  // Direct lookup
  if (KNOWN_GEO_HASHTAGS[lower]) return KNOWN_GEO_HASHTAGS[lower];

  // Try camelCase split (e.g. "McKenzieRiver" → "McKenzie River")
  const unslug = tag
    .replace(/^#/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();

  if (
    unslug !== tag.replace(/^#/, "") &&
    unslug.length >= 4 &&
    unslug.length <= 60 &&
    /^[A-Z]/.test(unslug)
  ) {
    return unslug;
  }

  return null;
}

// ─── Main extractor ───────────────────────────────────────────────────────────

export function extractCandidates(signals: LocationSignals): CandidatePlace[] {
  const candidates: CandidatePlace[] = [];

  console.log("[Extractor] Starting zero-compute extraction…");

  // ── 1. Native GPS tag — confidence 1.0 ────────────────────────────────────
  if (
    signals.location_name &&
    signals.location_lat !== null &&
    signals.location_lng !== null
  ) {
    console.log(`[Extractor] Native GPS tag: "${signals.location_name}"`);
    candidates.push({
      name: signals.location_name,
      raw: signals.location_name,
      source: "native_gps",
      confidence: 1.0,
    });
  }

  // ── 2. Anchor locations from video metadata — confidence 0.97 ─────────────
  for (const anchor of signals._anchorLocations ?? []) {
    const trimmed = anchor.trim();
    if (trimmed.length > 2) {
      console.log(`[Extractor] Anchor location: "${trimmed}"`);
      candidates.push({
        name: trimmed,
        raw: trimmed,
        source: "anchor_location",
        confidence: 0.97,
      });
    }
  }

  // ── 3. Pin emoji patterns in caption, bio, comments — confidence 0.95 ─────
  const pinTexts = [
    { text: signals.caption, label: "caption" },
    { text: signals.user_bio, label: "bio" },
    ...(signals.top_comments ?? []).map((c) => ({ text: c, label: "comment" })),
  ];
  const pinEmojiRe = /[📍📌🌍🌎🌏]\s*([\w\s,'\-\.]{3,60})/gu;
  for (const { text } of pinTexts) {
    if (!text) continue;
    let m: RegExpExecArray | null;
    while ((m = pinEmojiRe.exec(text)) !== null) {
      const candidate = m[1].trim().replace(/[.,!?\n]+$/, "");
      if (
        candidate.length >= 3 &&
        !GENERIC_WORDS.has(candidate.toLowerCase())
      ) {
        console.log(`[Extractor] Pin emoji: "${candidate}"`);
        candidates.push({
          name: candidate,
          raw: m[0],
          source: "pin_emoji",
          confidence: 0.95,
        });
      }
    }
  }

  // ── 4. Creator replies — confidence 0.90 ──────────────────────────────────
  for (const reply of signals._creatorComments ?? []) {
    const place = extractPlaceFromText(reply);
    if (place) {
      console.log(`[Extractor] Creator reply: "${place}"`);
      candidates.push({
        name: place,
        raw: reply,
        source: "creator_reply",
        confidence: 0.9,
      });
    }
  }

  // ── 4b. Top comment answers — confidence 0.65 ─────────────────────────────
  for (const comment of signals.top_comments ?? []) {
    const place = extractPlaceFromText(comment);
    if (place && !GENERIC_WORDS.has(place.toLowerCase())) {
      console.log(
        `[Extractor] Comment answer: "${place}" (from: "${comment.slice(0, 60)}")`,
      );
      candidates.push({
        name: place,
        raw: comment,
        source: "comment_answer",
        confidence: 0.65,
      });
    }
  }

  // ── 5. Caption explicit mention — confidence 0.85 ─────────────────────────
  if (signals.caption && signals.caption.trim().length > 3) {
    const place = extractPlaceFromText(signals.caption);
    if (place) {
      console.log(`[Extractor] Caption explicit: "${place}"`);
      candidates.push({
        name: place,
        raw: signals.caption,
        source: "caption_explicit",
        confidence: 0.85,
      });
    }
  }

  // ── 6. Geo-specific hashtags — confidence 0.80 ────────────────────────────
  const hashtagHits: string[] = [];
  for (const tag of signals.hashtags ?? []) {
    const place = hashtagToPlace(tag);
    if (place) {
      console.log(`[Extractor] Geo hashtag #${tag}: "${place}"`);
      hashtagHits.push(place);
      candidates.push({
        name: place,
        raw: `#${tag}`,
        source: "geo_hashtag",
        confidence: 0.8,
      });
    }
  }

  // ── 7. "X based" / "based in X" bio patterns — confidence 0.50 ────────────
  if (signals.user_bio) {
    const bioPatterns = [
      /\b([\w\s]{2,30})\s+based\b/i,
      /\bbased\s+(?:in|out\s+of)\s+([\w\s]{2,30})/i,
      /\bfrom\s+([\w\s]{2,30})(?:\s*[|•·,\n]|$)/i,
      /\bliving\s+in\s+([\w\s]{2,30})(?:\s*[|•·,\n]|$)/i,
      /\b(?:i\s+live\s+in|i['']m\s+(?:in|from))\s+([\w\s]{2,30})/i,
    ];
    for (const p of bioPatterns) {
      const m = signals.user_bio.match(p);
      if (m?.[1]) {
        const place = m[1]
          .trim()
          .replace(/[.,!?\n]+$/, "")
          .trim();
        if (
          place.length >= 3 &&
          place.length <= 50 &&
          !GENERIC_WORDS.has(place.toLowerCase())
        ) {
          console.log(`[Extractor] Bio "based" pattern: "${place}"`);
          candidates.push({
            name: place,
            raw: signals.user_bio,
            source: "bio_based",
            confidence: 0.5,
          });
          break;
        }
      }
    }
  }

  // ── 8. Multi-hashtag triangulation — boost by 0.15 if 2+ hashtags point same region ──
  if (hashtagHits.length >= 2) {
    // Extract country/region words from each hashtag hit and check overlap
    const regionWords = hashtagHits.map((h) => {
      const parts = h.split(",");
      return parts[parts.length - 1].trim().toLowerCase();
    });
    const regionFreq: Record<string, number> = {};
    for (const r of regionWords) {
      regionFreq[r] = (regionFreq[r] ?? 0) + 1;
    }
    for (const [region, count] of Object.entries(regionFreq)) {
      if (count >= 2) {
        // Boost all geo_hashtag candidates that share this region
        for (const c of candidates) {
          if (
            c.source === "geo_hashtag" &&
            c.name.toLowerCase().includes(region)
          ) {
            c.confidence = Math.min(1.0, c.confidence + 0.15);
          }
        }
        console.log(
          `[Extractor] Multi-hashtag triangulation: region "${region}" appears ${count}× — boosting confidence`,
        );
      }
    }
  }

  // ── 8b. Comment-mention vote triangulation ────────────────────────────────
  // If 2+ comments independently mention the same place → boost that candidate.
  // This handles the case where many viewers correctly name the location even
  // though no single comment is authoritative.
  {
    // Count how many raw comments contain each candidate name (case-insensitive)
    const commentPool = [
      ...(signals.top_comments ?? []),
      ...(signals._creatorComments ?? []),
    ];

    const voteCounts = new Map<string, number>();
    for (const c of candidates) {
      if (c.source === "comment_answer" || c.source === "creator_reply") {
        const key = c.name.toLowerCase().trim();
        if (!voteCounts.has(key)) {
          // Count how many distinct comments contain this name
          const nameRe = new RegExp(
            `\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
            "i",
          );
          const votes = commentPool.filter((txt) => nameRe.test(txt)).length;
          voteCounts.set(key, votes);
        }
        const votes = voteCounts.get(key) ?? 1;
        if (votes >= 3) {
          c.confidence = Math.min(1.0, c.confidence + 0.2);
          console.log(
            `[Extractor] Vote boost ×${votes} for "${c.name}" → conf ${c.confidence.toFixed(2)}`,
          );
        } else if (votes === 2) {
          c.confidence = Math.min(1.0, c.confidence + 0.1);
          console.log(
            `[Extractor] Vote boost ×2 for "${c.name}" → conf ${c.confidence.toFixed(2)}`,
          );
        }
      }
    }

    // Also: if a geo-whitelist word appears in 3+ comments, push it as a
    // comment_answer candidate even if extractPlaceFromText didn't catch it.
    // Handles short answers like "Flores", "Azores", "Hawaii" etc.
    for (const geoWord of GEO_WORD_WHITELIST) {
      const re = new RegExp(`\\b${geoWord}\\b`, "i");
      const matchingComments = commentPool.filter((txt) => re.test(txt));
      if (matchingComments.length >= 2) {
        const placeName = geoWord.charAt(0).toUpperCase() + geoWord.slice(1);
        const alreadyPresent = candidates.some(
          (c) => c.name.toLowerCase() === geoWord.toLowerCase(),
        );
        if (!alreadyPresent) {
          const confidence = Math.min(
            0.85,
            0.6 + matchingComments.length * 0.05,
          );
          console.log(
            `[Extractor] Comment geo-word vote "${placeName}" in ${matchingComments.length} comments → conf ${confidence.toFixed(2)}`,
          );
          candidates.push({
            name: placeName,
            raw: matchingComments[0],
            source: "comment_answer",
            confidence,
          });
        }
      }
    }
  }

  // ── 9. Tagged location accounts @visit_X / @iamX — confidence 0.70 ────────
  const allText = [
    signals.caption,
    signals.user_bio,
    ...(signals.top_comments ?? []),
    ...(signals._creatorComments ?? []),
  ].join(" ");
  const mentionRe = /@([\w]{3,40})/g;
  let mentionMatch: RegExpExecArray | null;
  while ((mentionMatch = mentionRe.exec(allText)) !== null) {
    const handle = mentionMatch[1].toLowerCase();
    const mapped = TOURISM_ACCOUNT_MAP[handle];
    if (mapped) {
      console.log(`[Extractor] Tagged tourism account @${handle}: "${mapped}"`);
      candidates.push({
        name: mapped,
        raw: `@${mentionMatch[1]}`,
        source: "tagged_account",
        confidence: 0.7,
      });
    }
  }

  // ── 10. Music title location — confidence 0.45 ────────────────────────────
  const captionLower = (signals.caption ?? "").toLowerCase();
  const hashtagText = (signals.hashtags ?? []).join(" ").toLowerCase();
  for (const [songTitle, placeName] of Object.entries(MUSIC_TITLE_PLACES)) {
    if (
      placeName &&
      placeName.length > 0 &&
      (captionLower.includes(songTitle) ||
        hashtagText.includes(songTitle.replace(/\s+/g, "")))
    ) {
      console.log(`[Extractor] Music title "${songTitle}": "${placeName}"`);
      candidates.push({
        name: placeName,
        raw: songTitle,
        source: "music_title",
        confidence: 0.45,
      });
    }
  }

  // ── De-duplicate: keep highest confidence per canonical name ──────────────
  const seen = new Map<string, CandidatePlace>();
  for (const c of candidates) {
    const key = c.name.toLowerCase().trim();
    const existing = seen.get(key);
    if (!existing || c.confidence > existing.confidence) {
      seen.set(key, c);
    }
  }

  const deduped = Array.from(seen.values()).sort(
    (a, b) => b.confidence - a.confidence,
  );

  console.log(
    `[Extractor] Found ${deduped.length} unique candidates:`,
    deduped
      .slice(0, 5)
      .map((c) => `"${c.name}" (${c.source}, ${c.confidence.toFixed(2)})`)
      .join(", "),
  );

  return deduped;
}
