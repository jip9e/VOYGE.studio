/**
 * @fileoverview Stage 2 — Multi-API Geocoding Cascade
 *
 * Given a place name (and optional context hints), resolves it to precise
 * GPS coordinates by trying multiple geocoding providers in sequence.
 * The cascade stops as soon as a result with confidence ≥ 0.85 is found,
 * or after all providers have been exhausted.
 *
 * ## Provider Cascade Order
 *
 * ### Standard places (default order)
 * 1. **Mapbox SearchBox** (`mapbox_searchbox`) — highest quality structured
 *    results with rich context (city, country, POI type). Preferred for most
 *    named places, restaurants, landmarks, and neighbourhoods.
 * 2. **Mapbox v5 Geocoding** (`mapbox_v5`) — legacy Mapbox endpoint; slightly
 *    lower confidence but broader coverage for obscure place names.
 * 3. **Nominatim / OpenStreetMap** (`nominatim`) — open data, good for
 *    cities, regions, and well-mapped features worldwide.
 * 4. **GeoNames** (`geonames`) — specialises in named geographic features,
 *    populated places, and administrative divisions. Requires `GEONAMES_USER`
 *    env var.
 * 5. **HERE Geocoding** (`here`) — commercial provider with strong POI
 *    coverage. Requires `HERE_API_KEY` env var.
 * 6. **OpenCage** (`opencage`) — aggregates many open data sources; good
 *    fallback for ambiguous or transliterated names. Requires
 *    `OPENCAGE_API_KEY` env var.
 * 7. **Overpass OSM** (`overpass_osm`) — raw OSM query engine; used as a
 *    last resort for any named OSM node/way/relation.
 *
 * ### Natural features (reordered)
 * When `options.isNaturalFeature` is `true` (rivers, waterfalls, mountains,
 * lakes, etc.), Overpass OSM and GeoNames are promoted to the front of the
 * queue since Mapbox often misses or mis-classifies natural features.
 *
 * ## Confidence Scoring
 *
 * Each provider returns a `confidence` value in the range `[0.0, 1.0]`.
 * Scores are assigned based on result quality signals:
 *
 * - Exact name match in returned address → higher score
 * - Result type matching expected category (e.g. POI vs. region) → bonus
 * - Provider-level base multipliers applied by the pipeline:
 *   `native_gps` 1.00 · `mapbox_searchbox` 0.97 · `mapbox_v5` 0.95 ·
 *   `nominatim` 0.90 · `geonames` 0.88 · `here` / `opencage` 0.88 ·
 *   `overpass_osm` 0.85
 *
 * The cascade always keeps the **best** result seen so far; a later provider
 * with higher confidence can override an earlier lower-confidence one.
 *
 * ## Native GPS Short-Circuit
 *
 * If `options.lat` and `options.lng` are both provided (i.e. the post has a
 * native platform GPS tag), the entire cascade is skipped and
 * `geocodeFromNativeGps()` returns immediately with confidence 1.0.
 *
 * ## Main Entry Point
 *
 * ```ts
 * const result = await geocodePlace("Horseshoe Bend", {
 *   countryHint: "US",
 *   regionHint: "Arizona",
 *   isNaturalFeature: true,
 * });
 * ```
 *
 * ### `geocodePlace(placeName, options?)` options
 * | Option              | Type      | Description                                      |
 * |---------------------|-----------|--------------------------------------------------|
 * | `lat`               | `number`  | Native GPS latitude (short-circuits cascade)     |
 * | `lng`               | `number`  | Native GPS longitude (short-circuits cascade)    |
 * | `countryHint`       | `string`  | ISO 3166-1 alpha-2 code or country name          |
 * | `regionHint`        | `string`  | State / broader region name                      |
 * | `isNaturalFeature`  | `boolean` | Reorders cascade to prioritise OSM + GeoNames    |
 *
 * ## Exported Symbols
 *
 * - `geocodePlace(placeName, options?)`     — Main entry point for the cascade.
 * - `geocodeSpotCompat(name, city)`         — Legacy shim matching old geocodeSpot() API.
 * - `geocodeFromNativeGps(lat, lng, name)`  — Direct native-GPS resolver (confidence 1.0).
 * - `GeocoderResult`                        — The geocoded location result type.
 *
 * @module location/geocoder
 */

// ─── Stage 2: Multi-API Geocoding Cascade ────────────────────────────────────
// Given a place name + optional context, tries multiple geocoding APIs in order,
// stopping when confidence ≥ 0.85. Falls back gracefully when APIs fail or are
// not configured.

export interface GeocoderResult {
  coordinates: [number, number]; // [lng, lat]
  full_address: string;
  country: string;
  city: string;
  mapbox_id: string | null;
  confidence: number; // 0.0 – 1.0
  source: string;
}

interface GeocoderContext {
  placeName: string;
  countryHint?: string; // 2-letter ISO or region name
  regionHint?: string; // broader region / state
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

/** Best-effort country-name → ISO-3166-1 alpha-2 */
function toCountryCode(hint: string): string {
  const h = hint.toLowerCase().trim();
  const MAP: Record<string, string> = {
    // Americas
    usa: "us",
    "united states": "us",
    america: "us",
    canada: "ca",
    mexico: "mx",
    brazil: "br",
    argentina: "ar",
    chile: "cl",
    colombia: "co",
    peru: "pe",
    venezuela: "ve",
    ecuador: "ec",
    bolivia: "bo",
    paraguay: "py",
    uruguay: "uy",
    cuba: "cu",
    jamaica: "jm",
    // US States → us
    oregon: "us",
    california: "us",
    washington: "us",
    colorado: "us",
    utah: "us",
    nevada: "us",
    texas: "us",
    florida: "us",
    hawaii: "us",
    alaska: "us",
    montana: "us",
    wyoming: "us",
    idaho: "us",
    arizona: "us",
    "new mexico": "us",
    // Europe
    uk: "gb",
    "united kingdom": "gb",
    england: "gb",
    scotland: "gb",
    wales: "gb",
    ireland: "ie",
    france: "fr",
    germany: "de",
    spain: "es",
    italy: "it",
    portugal: "pt",
    netherlands: "nl",
    belgium: "be",
    switzerland: "ch",
    austria: "at",
    sweden: "se",
    norway: "no",
    denmark: "dk",
    finland: "fi",
    iceland: "is",
    poland: "pl",
    "czech republic": "cz",
    czechia: "cz",
    hungary: "hu",
    romania: "ro",
    bulgaria: "bg",
    croatia: "hr",
    slovenia: "si",
    slovakia: "sk",
    serbia: "rs",
    greece: "gr",
    turkey: "tr",
    ukraine: "ua",
    russia: "ru",
    estonia: "ee",
    latvia: "lv",
    lithuania: "lt",
    luxembourg: "lu",
    monaco: "mc",
    montenegro: "me",
    albania: "al",
    moldova: "md",
    georgia: "ge",
    armenia: "am",
    azerbaijan: "az",
    // Asia
    japan: "jp",
    "south korea": "kr",
    korea: "kr",
    china: "cn",
    taiwan: "tw",
    "hong kong": "hk",
    thailand: "th",
    vietnam: "vn",
    cambodia: "kh",
    laos: "la",
    myanmar: "mm",
    indonesia: "id",
    bali: "id",
    malaysia: "my",
    singapore: "sg",
    philippines: "ph",
    india: "in",
    nepal: "np",
    "sri lanka": "lk",
    bangladesh: "bd",
    pakistan: "pk",
    kazakhstan: "kz",
    uzbekistan: "uz",
    // Middle East
    uae: "ae",
    "united arab emirates": "ae",
    dubai: "ae",
    "saudi arabia": "sa",
    jordan: "jo",
    israel: "il",
    lebanon: "lb",
    oman: "om",
    qatar: "qa",
    bahrain: "bh",
    kuwait: "kw",
    iran: "ir",
    iraq: "iq",
    morocco: "ma",
    egypt: "eg",
    tunisia: "tn",
    algeria: "dz",
    libya: "ly",
    // Africa
    "south africa": "za",
    kenya: "ke",
    tanzania: "tz",
    ethiopia: "et",
    nigeria: "ng",
    ghana: "gh",
    senegal: "sn",
    cameroon: "cm",
    mozambique: "mz",
    zimbabwe: "zw",
    zambia: "zm",
    uganda: "ug",
    rwanda: "rw",
    madagascar: "mg",
    mauritius: "mu",
    seychelles: "sc",
    zanzibar: "tz",
    // Pacific
    australia: "au",
    "new zealand": "nz",
    fiji: "fj",
  };
  // Direct lookup
  if (MAP[h]) return MAP[h];
  // Partial match
  for (const [key, code] of Object.entries(MAP)) {
    if (h.includes(key) || key.includes(h)) return code;
  }
  return "";
}

/** Fetch with timeout and graceful error */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Geocoder 1: Native GPS ────────────────────────────────────────────────────

export function geocodeFromNativeGps(
  lat: number,
  lng: number,
  name: string,
): GeocoderResult {
  console.log(`[Geocoder] Native GPS: (${lat}, ${lng})`);
  return {
    coordinates: [lng, lat],
    full_address: name,
    country: "Unknown",
    city: name,
    mapbox_id: null,
    confidence: 1.0,
    source: "native_gps",
  };
}

// ─── Geocoder 2: Mapbox SearchBox v1 ─────────────────────────────────────────

async function geocodeMapboxSearchBox(
  ctx: GeocoderContext,
): Promise<GeocoderResult | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    const query = ctx.placeName;
    const countryCode = ctx.countryHint ? toCountryCode(ctx.countryHint) : "";
    const params = new URLSearchParams({
      q: query,
      access_token: MAPBOX_TOKEN,
      types: "poi,place,region,locality,neighborhood,address",
      limit: "3",
    });
    if (countryCode) params.set("country", countryCode);

    const url = `https://api.mapbox.com/search/searchbox/v1/forward?${params}`;
    const res = await fetchWithTimeout(url, { timeoutMs: 9000 });
    if (!res.ok) return null;

    const data = (await res.json()) as { features?: unknown[] };
    const features = data.features ?? [];
    if (features.length === 0) return null;

    // Pick best feature: prefer POI / place over region
    const best = pickBestMapboxFeature(
      features as Record<string, unknown>[],
      query,
    );
    const coords = (best.geometry as { coordinates: [number, number] })
      ?.coordinates;
    if (!coords) return null;

    const props = (best.properties as Record<string, unknown>) ?? {};
    const ctx2 =
      (props.context as Record<string, Record<string, string>>) ?? {};

    const country =
      ctx2.country?.name ??
      ctx2.country?.text ??
      extractCountryFromMapboxContext(ctx2) ??
      "Unknown";
    const city =
      ctx2.place?.name ??
      ctx2.locality?.name ??
      ctx2.district?.name ??
      (props.name as string) ??
      query;

    console.log(
      `[Geocoder] Mapbox SearchBox: "${props.full_address ?? props.name}" [${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}]`,
    );
    return {
      coordinates: coords,
      full_address:
        (props.full_address as string) ??
        (props.place_formatted as string) ??
        (props.name as string) ??
        query,
      country,
      city,
      mapbox_id: (props.mapbox_id as string) ?? null,
      confidence: 0.88,
      source: "mapbox_searchbox",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Geocoder] Mapbox SearchBox failed:", msg);
    return null;
  }
}

// ─── Geocoder 3: Mapbox Geocoding v5 ─────────────────────────────────────────

async function geocodeMapboxV5(
  ctx: GeocoderContext,
): Promise<GeocoderResult | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    const query = ctx.countryHint
      ? `${ctx.placeName}, ${ctx.countryHint}`
      : ctx.placeName;

    const params = new URLSearchParams({
      access_token: MAPBOX_TOKEN,
      types: "poi,place,region,locality,address",
      limit: "3",
    });
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params}`;
    const res = await fetchWithTimeout(url, { timeoutMs: 9000 });
    if (!res.ok) return null;

    const data = (await res.json()) as { features?: unknown[] };
    const features = (data.features ?? []) as Record<string, unknown>[];
    if (features.length === 0) return null;

    const best = features[0];
    const coords = (best.geometry as { coordinates: [number, number] })
      ?.coordinates;
    if (!coords) return null;

    const context = ((best.context as unknown[]) ?? []) as Record<
      string,
      string
    >[];
    const country =
      context.find((c) => c.id?.startsWith("country"))?.text ?? "Unknown";
    const city =
      context.find((c) => c.id?.startsWith("place"))?.text ??
      context.find((c) => c.id?.startsWith("locality"))?.text ??
      (best.place_name as string)?.split(",")[0] ??
      ctx.placeName;

    console.log(
      `[Geocoder] Mapbox v5: "${best.place_name}" [${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}]`,
    );
    return {
      coordinates: coords,
      full_address: (best.place_name as string) ?? ctx.placeName,
      country,
      city,
      mapbox_id: (best.id as string) ?? null,
      confidence: 0.85,
      source: "mapbox_v5",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Geocoder] Mapbox v5 failed:", msg);
    return null;
  }
}

// ─── Geocoder 4: Nominatim (OSM) ─────────────────────────────────────────────

async function geocodeNominatim(
  ctx: GeocoderContext,
): Promise<GeocoderResult | null> {
  try {
    const query = ctx.countryHint
      ? `${ctx.placeName}, ${ctx.countryHint}`
      : ctx.placeName;

    const params = new URLSearchParams({
      q: query,
      format: "json",
      limit: "3",
      addressdetails: "1",
    });
    const url = `https://nominatim.openstreetmap.org/search?${params}`;
    const res = await fetchWithTimeout(url, {
      timeoutMs: 10000,
      headers: {
        "User-Agent": "VOYGE/1.0 (travel discovery app)",
        "Accept-Language": "en",
      },
    });
    if (!res.ok) return null;

    const results = (await res.json()) as unknown[];
    if (!Array.isArray(results) || results.length === 0) return null;

    const best = results[0] as Record<string, unknown>;
    const lat = parseFloat(best.lat as string);
    const lon = parseFloat(best.lon as string);
    if (isNaN(lat) || isNaN(lon)) return null;

    const address = (best.address as Record<string, string>) ?? {};
    const country = address.country ?? "Unknown";
    const city =
      address.city ??
      address.town ??
      address.village ??
      address.municipality ??
      address.county ??
      ctx.placeName;
    const displayName = (best.display_name as string) ?? ctx.placeName;

    // Map OSM importance score (0–1) to our confidence range
    const importance = parseFloat((best.importance as string) ?? "0.5");
    const confidence = Math.min(0.82, 0.55 + importance * 0.3);

    console.log(
      `[Geocoder] Nominatim: "${displayName}" [${lat.toFixed(4)}, ${lon.toFixed(4)}]`,
    );
    return {
      coordinates: [lon, lat],
      full_address: displayName,
      country,
      city,
      mapbox_id: null,
      confidence,
      source: "nominatim",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Geocoder] Nominatim failed:", msg);
    return null;
  }
}

// ─── Geocoder 5: GeoNames (natural features) ─────────────────────────────────

async function geocodeGeoNames(
  ctx: GeocoderContext,
): Promise<GeocoderResult | null> {
  const username = process.env.GEONAMES_USERNAME;
  if (!username) return null;
  try {
    const params = new URLSearchParams({
      q: ctx.placeName,
      maxRows: "5",
      username,
      type: "json",
      style: "FULL",
      // Search rivers, lakes, mountains, natural features, parks
      featureClass: "H", // hydrographic
    });

    // Try hydrographic first, then terrain, then landscape
    for (const featureClass of ["H", "T", "L"]) {
      params.set("featureClass", featureClass);
      const url = `http://api.geonames.org/searchJSON?${params}`;
      const res = await fetchWithTimeout(url, { timeoutMs: 8000 });
      if (!res.ok) continue;

      const data = (await res.json()) as { geonames?: unknown[] };
      const geonames = (data.geonames ?? []) as Record<string, unknown>[];
      if (geonames.length === 0) continue;

      const best = geonames[0];
      const lat = parseFloat(best.lat as string);
      const lng = parseFloat(best.lng as string);
      if (isNaN(lat) || isNaN(lng)) continue;

      const country = (best.countryName as string) ?? "Unknown";
      const city =
        (best.adminName1 as string) ??
        (best.adminName2 as string) ??
        ctx.placeName;
      const name = (best.name as string) ?? ctx.placeName;

      console.log(
        `[Geocoder] GeoNames (${featureClass}): "${name}" [${lat.toFixed(4)}, ${lng.toFixed(4)}]`,
      );
      return {
        coordinates: [lng, lat],
        full_address: `${name}, ${country}`,
        country,
        city,
        mapbox_id: null,
        confidence: 0.78,
        source: "geonames",
      };
    }
    return null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Geocoder] GeoNames failed:", msg);
    return null;
  }
}

// ─── Geocoder 6: HERE Geocoding ───────────────────────────────────────────────

async function geocodeHERE(
  ctx: GeocoderContext,
): Promise<GeocoderResult | null> {
  const apiKey = process.env.HERE_API_KEY;
  if (!apiKey) return null;
  try {
    const query = ctx.countryHint
      ? `${ctx.placeName}, ${ctx.countryHint}`
      : ctx.placeName;

    const params = new URLSearchParams({ q: query, apiKey, limit: "3" });
    const url = `https://geocode.search.hereapi.com/v1/geocode?${params}`;
    const res = await fetchWithTimeout(url, { timeoutMs: 9000 });
    if (!res.ok) return null;

    const data = (await res.json()) as { items?: unknown[] };
    const items = (data.items ?? []) as Record<string, unknown>[];
    if (items.length === 0) return null;

    const best = items[0];
    const pos = best.position as { lat: number; lng: number };
    if (!pos) return null;

    const address = (best.address as Record<string, string>) ?? {};
    const country = address.countryName ?? "Unknown";
    const city =
      address.city ?? address.county ?? address.state ?? ctx.placeName;

    console.log(
      `[Geocoder] HERE: "${best.title}" [${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}]`,
    );
    return {
      coordinates: [pos.lng, pos.lat],
      full_address: (best.title as string) ?? ctx.placeName,
      country,
      city,
      mapbox_id: null,
      confidence: 0.82,
      source: "here",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Geocoder] HERE failed:", msg);
    return null;
  }
}

// ─── Geocoder 7: OpenCage ─────────────────────────────────────────────────────

async function geocodeOpenCage(
  ctx: GeocoderContext,
): Promise<GeocoderResult | null> {
  const apiKey = process.env.OPENCAGE_API_KEY;
  if (!apiKey) return null;
  try {
    const query = ctx.countryHint
      ? `${ctx.placeName}, ${ctx.countryHint}`
      : ctx.placeName;

    const params = new URLSearchParams({
      q: query,
      key: apiKey,
      limit: "3",
      no_annotations: "1",
      language: "en",
    });
    if (ctx.countryHint) {
      const cc = toCountryCode(ctx.countryHint);
      if (cc) params.set("countrycode", cc);
    }

    const url = `https://api.opencagedata.com/geocode/v1/json?${params}`;
    const res = await fetchWithTimeout(url, { timeoutMs: 9000 });
    if (!res.ok) return null;

    const data = (await res.json()) as { results?: unknown[] };
    const results = (data.results ?? []) as Record<string, unknown>[];
    if (results.length === 0) return null;

    const best = results[0];
    const geometry = best.geometry as { lat: number; lng: number };
    if (!geometry) return null;

    const components = (best.components as Record<string, string>) ?? {};
    const country = components.country ?? "Unknown";
    const city =
      components.city ??
      components.town ??
      components.village ??
      components.county ??
      ctx.placeName;
    const formatted = (best.formatted as string) ?? ctx.placeName;

    // OpenCage confidence is 0–10; normalise to 0.5–0.85
    const ocConf = parseInt(
      ((best.confidence as string | number) ?? 0).toString(),
      10,
    );
    const confidence = Math.min(0.85, 0.5 + (ocConf / 10) * 0.35);

    console.log(
      `[Geocoder] OpenCage: "${formatted}" [${geometry.lat.toFixed(4)}, ${geometry.lng.toFixed(4)}] conf=${ocConf}/10`,
    );
    return {
      coordinates: [geometry.lng, geometry.lat],
      full_address: formatted,
      country,
      city,
      mapbox_id: null,
      confidence,
      source: "opencage",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Geocoder] OpenCage failed:", msg);
    return null;
  }
}

// ─── Geocoder 8: OSM Overpass (natural features) ──────────────────────────────

/** Detect what natural feature type a place name looks like */
function detectFeatureType(
  name: string,
): { osmKey: string; osmValue: string } | null {
  const lower = name.toLowerCase();
  if (/\b(river|creek|stream|brook)\b/.test(lower))
    return { osmKey: "waterway", osmValue: "river" };
  if (/\b(lake|pond|reservoir|loch|lagoon|tarn)\b/.test(lower))
    return { osmKey: "natural", osmValue: "water" };
  if (/\b(waterfall|falls|cascade)\b/.test(lower))
    return { osmKey: "waterway", osmValue: "waterfall" };
  if (/\b(mountain|mount|peak|summit|hill|volcano|mt\.?)\b/.test(lower))
    return { osmKey: "natural", osmValue: "peak" };
  if (/\b(beach|bay|cove|shore)\b/.test(lower))
    return { osmKey: "natural", osmValue: "beach" };
  if (/\b(forest|wood|woods|jungle)\b/.test(lower))
    return { osmKey: "natural", osmValue: "wood" };
  if (/\b(park|reserve|preserve|refuge)\b/.test(lower))
    return { osmKey: "leisure", osmValue: "nature_reserve" };
  if (/\b(trail|path|track|hike)\b/.test(lower))
    return { osmKey: "highway", osmValue: "path" };
  return null;
}

async function geocodeOverpass(
  ctx: GeocoderContext,
): Promise<GeocoderResult | null> {
  const featureType = detectFeatureType(ctx.placeName);
  if (!featureType) return null; // Only useful for natural features

  try {
    // Extract just the base name without type words for cleaner matching
    const baseName = ctx.placeName
      .replace(
        /\b(river|lake|falls|waterfall|mountain|mount|mt\.?|beach|trail|creek|park|peak|national)\b/gi,
        "",
      )
      .trim()
      .replace(/\s+/g, " ");

    const nameToSearch = baseName.length >= 3 ? baseName : ctx.placeName;

    // Build Overpass query
    let query: string;
    if (ctx.regionHint ?? ctx.countryHint) {
      const region = ctx.regionHint ?? ctx.countryHint ?? "";
      // Search within a named area
      query = `
[out:json][timeout:15];
area[name~"${region}",i]->.searchArea;
(
  way["${featureType.osmKey}"="${featureType.osmValue}"][name~"${nameToSearch}",i](area.searchArea);
  node["${featureType.osmKey}"="${featureType.osmValue}"][name~"${nameToSearch}",i](area.searchArea);
  relation["${featureType.osmKey}"="${featureType.osmValue}"][name~"${nameToSearch}",i](area.searchArea);
);
out center 3;
`.trim();
    } else {
      query = `
[out:json][timeout:15];
(
  way["${featureType.osmKey}"="${featureType.osmValue}"][name~"${nameToSearch}",i];
  node["${featureType.osmKey}"="${featureType.osmValue}"][name~"${nameToSearch}",i];
);
out center 3;
`.trim();
    }

    const res = await fetchWithTimeout(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        body: query,
        headers: { "Content-Type": "text/plain" },
        timeoutMs: 18000,
      },
    );
    if (!res.ok) return null;

    const data = (await res.json()) as { elements?: unknown[] };
    const elements = (data.elements ?? []) as Record<string, unknown>[];
    if (elements.length === 0) return null;

    // Prefer elements with a center (ways/relations) then nodes
    const best = elements.find((e) => e.center) ?? elements[0];
    const center = best.center as { lat: number; lon: number } | undefined;
    const lat = center?.lat ?? (best.lat as number);
    const lon = center?.lon ?? (best.lon as number);

    if (!lat || !lon) return null;

    const tags = (best.tags as Record<string, string>) ?? {};
    const name = tags.name ?? ctx.placeName;

    console.log(
      `[Geocoder] Overpass OSM: "${name}" [${lat.toFixed(4)}, ${lon.toFixed(4)}]`,
    );
    return {
      coordinates: [lon, lat],
      full_address: ctx.countryHint ? `${name}, ${ctx.countryHint}` : name,
      country: ctx.countryHint ?? "Unknown",
      city: ctx.regionHint ?? ctx.countryHint ?? name,
      mapbox_id: null,
      confidence: 0.75,
      source: "overpass_osm",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Geocoder] Overpass OSM failed:", msg);
    return null;
  }
}

// ─── Mapbox feature selection helpers ─────────────────────────────────────────

function pickBestMapboxFeature(
  features: Record<string, unknown>[],
  query: string,
): Record<string, unknown> {
  const q = query.toLowerCase();
  // Prefer an exact name match
  const exact = features.find((f) => {
    const props = f.properties as Record<string, string> | undefined;
    return props?.name?.toLowerCase() === q;
  });
  return exact ?? features[0];
}

function extractCountryFromMapboxContext(
  ctx: Record<string, Record<string, string>>,
): string | null {
  return ctx.country?.name ?? ctx.country?.text ?? null;
}

// ─── Main cascade ─────────────────────────────────────────────────────────────

/**
 * Runs geocoding APIs in order, stopping when a result with confidence ≥ 0.85
 * is found or all APIs have been tried.
 */
export async function geocodePlace(
  placeName: string,
  options: {
    lat?: number | null;
    lng?: number | null;
    countryHint?: string;
    regionHint?: string;
    /** If true, prioritise natural-feature APIs (GeoNames, Overpass) */
    isNaturalFeature?: boolean;
  } = {},
): Promise<GeocoderResult | null> {
  const { lat, lng, countryHint, regionHint, isNaturalFeature } = options;

  console.log(
    `[Geocoder] Starting cascade for "${placeName}"` +
      (countryHint ? ` (country hint: ${countryHint})` : "") +
      (regionHint ? ` (region hint: ${regionHint})` : ""),
  );

  // ── Stage 1: Native GPS — short-circuit everything ────────────────────────
  if (lat != null && lng != null) {
    return geocodeFromNativeGps(lat, lng, placeName);
  }

  const ctx: GeocoderContext = { placeName, countryHint, regionHint };
  const CONFIDENCE_THRESHOLD = 0.85;

  // ── Determine geocoder order ───────────────────────────────────────────────
  // For natural features: try Overpass + GeoNames early since Mapbox often
  // misses rivers / waterfalls.
  const geocoders: Array<() => Promise<GeocoderResult | null>> =
    isNaturalFeature
      ? [
          () => geocodeOverpass(ctx),
          () => geocodeGeoNames(ctx),
          () => geocodeMapboxSearchBox(ctx),
          () => geocodeMapboxV5(ctx),
          () => geocodeNominatim(ctx),
          () => geocodeHERE(ctx),
          () => geocodeOpenCage(ctx),
        ]
      : [
          () => geocodeMapboxSearchBox(ctx),
          () => geocodeMapboxV5(ctx),
          () => geocodeNominatim(ctx),
          () => geocodeGeoNames(ctx),
          () => geocodeHERE(ctx),
          () => geocodeOpenCage(ctx),
          () => geocodeOverpass(ctx),
        ];

  let best: GeocoderResult | null = null;

  for (const geocoder of geocoders) {
    let result: GeocoderResult | null = null;
    try {
      result = await geocoder();
    } catch {
      // individual errors already logged inside each geocoder
      continue;
    }

    if (!result) continue;

    // Keep the highest-confidence result seen so far
    if (!best || result.confidence > best.confidence) {
      best = result;
    }

    // Early exit if we have a high-confidence result
    if (best.confidence >= CONFIDENCE_THRESHOLD) {
      console.log(
        `[Geocoder] ✅ Hit confidence threshold (${best.confidence.toFixed(2)}) via ${best.source} — stopping cascade`,
      );
      break;
    }
  }

  if (best) {
    console.log(
      `[Geocoder] Final result: "${best.full_address}" via ${best.source} (conf=${best.confidence.toFixed(2)})`,
    );
  } else {
    console.warn(`[Geocoder] ❌ All geocoders failed for "${placeName}"`);
  }

  return best;
}

/**
 * Convenience wrapper that mirrors the old geocodeSpot(name, city) signature.
 * Used by the updated geo.ts shim.
 */
export async function geocodeSpotCompat(
  name: string,
  city: string,
): Promise<{
  coordinates: [number, number];
  full_address: string;
  mapbox_id: string | null;
  country: string;
  city: string;
}> {
  const result = await geocodePlace(name, { countryHint: city });
  if (!result) {
    return {
      coordinates: [0, 0],
      full_address: name,
      mapbox_id: null,
      country: "Unknown",
      city: city || name,
    };
  }
  return {
    coordinates: result.coordinates,
    full_address: result.full_address,
    mapbox_id: result.mapbox_id,
    country: result.country,
    city: result.city,
  };
}
