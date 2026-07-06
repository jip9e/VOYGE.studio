/**
 * @fileoverview Social Media Scrapers — Instagram & TikTok
 *
 * This module provides two primary scrapers (`scrapeInstagram` and
 * `scrapeTikTok`) that extract rich post data from public Instagram Reels/posts
 * and TikTok videos. Both scrapers operate through RapidAPI-hosted third-party
 * endpoints and implement multi-layer fallback strategies so that a transient
 * API failure never silently returns empty data.
 *
 * Both scrapers return a `RichPostData` object that is then consumed by the
 * location extraction pipeline (`src/lib/location/`) and the legacy AI
 * extractor (`src/lib/ai.ts`).
 *
 * ## Instagram Scraper — `scrapeInstagram(url)`
 *
 * Attempts four API layers in sequence, stopping as soon as a layer returns
 * a usable caption or thumbnail:
 *
 * | Layer | API Host                        | Endpoint            | Notes                          |
 * |-------|---------------------------------|---------------------|--------------------------------|
 * | L1    | `instagram-scraper-api2`        | `/v1/post_info`     | Richest data; location tag, bio|
 * | L2    | `instagram-scraper-api2`        | `/v1.1/post_info`   | Alternative version of same API|
 * | L3    | `instagram120`                  | `/v1/post_info`     | Secondary provider             |
 * | L4    | Instagram oEmbed (public)       | `api/oembed`        | No auth, minimal data          |
 *
 * After the main post fetch, Layer 1 also attempts to pull:
 * - **Comments** (up to 30) from `/v1/comments` — used for vote triangulation
 *   and creator-reply detection.
 * - **User bio** from `/v1/user_info` — used as a geographic hint.
 *
 * The scraper populates `_creatorComments` (comments by the post author) and
 * `_anchorLocations` (explicit location strings found in the structured data).
 *
 * ## TikTok Scraper — `scrapeTikTok(url)`
 *
 * Attempts two primary API providers plus several sub-layers:
 *
 * | Layer | API Host / Service              | Endpoint              | Notes                               |
 * |-------|---------------------------------|-----------------------|-------------------------------------|
 * | L1    | `tikwm.com`                     | `/api/`               | Primary: caption, hashtags, POI     |
 * | L1.5  | `tiktok-scraper7` (RapidAPI)    | `/video/info`         | Richer desc + textExtra hashtags    |
 * | L2    | `tiktok-scraper7` (RapidAPI)    | `/comment/list`       | Comments for creator-reply detection|
 * | L2b   | `tikwm.com`                     | `/api/comment/list`   | Comment fallback                    |
 * | L3    | `tikwm.com`                     | `/api/user/detail`    | User bio                            |
 * | L3b   | `tiktok-scraper7` (RapidAPI)    | `/user/info`          | User bio fallback                   |
 *
 * Short TikTok URLs (vt.tiktok.com, vm.tiktok.com) are resolved to canonical
 * long-form URLs before any API calls are made.
 *
 * ## Returned Data — `RichPostData`
 *
 * Both scrapers return the same `RichPostData` shape:
 *
 * ```ts
 * {
 *   caption          // Full post caption / description text
 *   hashtags         // Array of hashtag strings (without #)
 *   top_comments     // Up to 30 most relevant comments
 *   user_bio         // Creator's profile bio
 *   location_name    // Native platform location tag name (or null)
 *   location_lat     // Native GPS latitude (or null)
 *   location_lng     // Native GPS longitude (or null)
 *   thumbnail        // Best available thumbnail URL (or null)
 *   author_username  // Creator's @handle
 *   platform         // "instagram" | "tiktok"
 *   post_id          // Platform-native post/video ID
 *
 *   // Enrichment fields (populated where available)
 *   _creatorComments // Comments posted by the creator themselves
 *   _anchorLocations // Location strings from video metadata (TikTok POI anchors)
 *   _compositeHints  // Region + environment type pairs inferred from signals
 * }
 * ```
 *
 * ## Signal Extraction Helpers
 *
 * Several helper functions run on the raw scraped text before it leaves the
 * module:
 *
 * - `extractLocationSignals(text)` — Runs NLP-lite pattern matching to pull
 *   explicit location mentions from any text string.
 * - `filterUsefulComments(comments, authorUsername)` — Separates comments into
 *   creator replies and viewer comments, and scores each comment for location
 *   relevance.
 * - `buildCompositeHints(signals)` — Combines region hints (from hashtags, bio,
 *   captions) with environment-type hints (beach, mountain, forest, etc.) to
 *   produce `CompositeLocationHint` objects that give the AI pipeline richer
 *   spatial context.
 *
 * ## Environment Variables Required
 *
 * - `RAPIDAPI_KEY` — RapidAPI subscription key used by all RapidAPI-hosted
 *   endpoints (instagram-scraper-api2, instagram120, tiktok-scraper7).
 *
 * @module scrapers
 */

import axios from "axios";
import type { AxiosResponse } from "axios";
import { extractPlaceFromText } from "@/lib/location/extractor";

// ─── Location Pre-Processor ───────────────────────────────────────────────────
// Runs before AI to extract structured location signals from raw text.
// This gives the AI concrete candidates instead of raw messy comment text.

// Known location question patterns — comments asking WHERE this is
const LOCATION_QUESTION_PATTERNS = [
  /where\s+(is|was|are)\s+(this|that|here|you|it)/i,
  /what\s+(place|location|country|city|spot|is\s+this)/i,
  /which\s+(country|city|place|island|region)/i,
  /where\s+(?:exactly|in\s+the\s+world|are\s+you)/i,
  /name\s+of\s+(this|the)\s+(place|location|spot|beach|restaurant)/i,
  /can\s+(you|u)\s+(tell|share|drop)\s+(me\s+)?(the\s+)?(location|name|place)/i,
  /drop\s+(the\s+)?(location|loc|name|place)/i,
  /pls|please\s+(share|tell|drop)\s+(location|loc|where)/i,
  /^\s*where\??[\s!]*$/i,
  /location\?/i,
  /what['']?s\s+(the\s+)?(name|location|place)/i,
];

// Patterns that ANSWER a location question (name-drops a place)
const LOCATION_ANSWER_PATTERNS = [
  /(?:it[''']?s?|this\s+is|that[''']?s?|we[''']?re\s+(?:at|in))\s+([A-Z][^!?.]{3,60})/,
  /(?:located?\s+(?:at|in))\s+([A-Z][^!?.]{3,60})/i,
  /(?:filmed?\s+(?:at|in))\s+([A-Z][^!?.]{3,60})/i,
  /(?:shot\s+(?:at|in))\s+([A-Z][^!?.]{3,60})/i,
  /(?:^|[\s,])(?:in|at|visiting|explore)\s+([A-Z][^!?.]{3,50})(?:[,!.]|$)/,
];

// Country / major city name mentions (very conservative, avoids false positives)
const KNOWN_GEO_WORDS = new Set([
  // Countries
  "Iceland",
  "Norway",
  "Sweden",
  "Finland",
  "Denmark",
  "Switzerland",
  "Austria",
  "Japan",
  "Thailand",
  "Indonesia",
  "Bali",
  "Vietnam",
  "Cambodia",
  "Philippines",
  "Morocco",
  "Egypt",
  "Tunisia",
  "Kenya",
  "Tanzania",
  "South Africa",
  "Turkey",
  "Greece",
  "Italy",
  "France",
  "Spain",
  "Portugal",
  "Croatia",
  "Montenegro",
  "Dubai",
  "UAE",
  "Qatar",
  "Oman",
  "Jordan",
  "Israel",
  "Georgia",
  "Mexico",
  "Colombia",
  "Peru",
  "Brazil",
  "Argentina",
  "Chile",
  "Costa Rica",
  "Australia",
  "New Zealand",
  "Maldives",
  "Sri Lanka",
  "Nepal",
  "Bhutan",
  "India",
  "Canada",
  "Ireland",
  "Scotland",
  "Wales",
  "England",
  "Netherlands",
  "Belgium",
  "Germany",
  "Czech Republic",
  "Poland",
  "Hungary",
  "Romania",
  "Albania",
  "Kosovo",
  "Singapore",
  "Malaysia",
  "Taiwan",
  "South Korea",
  "China",
  "Hong Kong",
  "Macau",
  // US States & regions (critical for US-based creators)
  "Oregon",
  "Washington",
  "California",
  "Colorado",
  "Utah",
  "Arizona",
  "Montana",
  "Wyoming",
  "Idaho",
  "Nevada",
  "Alaska",
  "Hawaii",
  "Texas",
  "Florida",
  "New York",
  "Tennessee",
  "North Carolina",
  "South Carolina",
  "Virginia",
  "Vermont",
  "Maine",
  "New Hampshire",
  "Michigan",
  "Minnesota",
  "Wisconsin",
  "Missouri",
  "New Mexico",
  "Oklahoma",
  "Louisiana",
  "Georgia",
  "Kentucky",
  "West Virginia",
  "Pennsylvania",
  "Massachusetts",
  // US National Parks & famous natural landmarks
  "Olympic National Park",
  "Crater Lake",
  "Mount Hood",
  "Columbia River Gorge",
  "Multnomah Falls",
  "Mackenzie River",
  "McKenzie River",
  "Willamette Valley",
  "Cascade Mountains",
  "Rocky Mountains",
  "Grand Canyon",
  "Yellowstone",
  "Yosemite",
  "Zion",
  "Bryce Canyon",
  "Arches",
  "Glacier National Park",
  "Great Smoky Mountains",
  "Sequoia",
  "Joshua Tree",
  "Death Valley",
  "Acadia",
  "Banff",
  "Jasper",
  "Vancouver Island",
  "Patagonia",
  "Appalachian",
  "Pacific Crest Trail",
  // Major cities
  "Reykjavik",
  "Tromsø",
  "Bergen",
  "Oslo",
  "Copenhagen",
  "Stockholm",
  "Helsinki",
  "Tokyo",
  "Kyoto",
  "Osaka",
  "Seoul",
  "Bangkok",
  "Chiang Mai",
  "Hanoi",
  "Hoi An",
  "Marrakech",
  "Casablanca",
  "Cape Town",
  "Nairobi",
  "Zanzibar",
  "Istanbul",
  "Athens",
  "Rome",
  "Florence",
  "Venice",
  "Paris",
  "Barcelona",
  "Madrid",
  "Lisbon",
  "Porto",
  "Dubrovnik",
  "Kotor",
  "Santorini",
  "Mykonos",
  "Crete",
  "Abu Dhabi",
  "Doha",
  "Muscat",
  "Amman",
  "Tbilisi",
  "Cancun",
  "Tulum",
  "Cartagena",
  "Medellin",
  "Lima",
  "Rio",
  "Buenos Aires",
  "Santiago",
  "Sydney",
  "Melbourne",
  "Auckland",
  "Queenstown",
  "Colombo",
  "Kathmandu",
  "Los Angeles",
  "Miami",
  "Chicago",
  "Las Vegas",
  "San Francisco",
  "Seattle",
  "Portland",
  "Denver",
  "Phoenix",
  "Salt Lake City",
  "Nashville",
  "London",
  "Edinburgh",
  "Dublin",
  "Amsterdam",
  "Brussels",
  "Berlin",
  "Prague",
  "Ubud",
  "Seminyak",
  "Lombok",
  "Raja Ampat",
  "Flores",
  "Phuket",
  "Koh Samui",
  "Krabi",
  "Pai",
  "Chiang Rai",
  "Amalfi",
  "Positano",
  "Cinque Terre",
  "Capri",
  "Sardinia",
  "Sicily",
  "Hallstatt",
  "Interlaken",
  "Zermatt",
  "Luzern",
  "Zurich",
  "Halong Bay",
  "Phong Nha",
  "Da Nang",
  "Ho Chi Minh",
  "Sapa",
]);

// Nature/environment contextual clues — NOT locations themselves but narrow the search
// when combined with a known geo region (e.g. "river" + "Oregon" → Oregon river)
const NATURE_CONTEXT_WORDS = [
  "river",
  "waterfall",
  "falls",
  "lake",
  "ocean",
  "beach",
  "mountain",
  "forest",
  "canyon",
  "valley",
  "glacier",
  "fjord",
  "desert",
  "trail",
  "national park",
  "coast",
  "island",
  "creek",
  "gorge",
  "cliff",
  "cave",
  "hot spring",
  "volcano",
  "jungle",
  "rainforest",
];

interface LocationSignal {
  text: string;
  source:
    | "caption"
    | "comment_answer"
    | "comment_geo"
    | "bio"
    | "hashtag"
    | "creator_reply"
    | "context_clue";
  confidence: "high" | "medium" | "low";
  raw: string;
}

// Combined signal: geo region + nature context clue (e.g. "Oregon river")
interface CompositeLocationHint {
  region: string;
  context: string;
  combined: string; // e.g. "Oregon river" → AI can infer "McKenzie River, Oregon"
  confidence: "medium" | "low";
}

/**
 * Analyse comments to find:
 * 1. Creator replies that answer "where is this?" questions
 * 2. Comments that directly mention known geo-words
 * 3. Comments that match answer patterns (it's X, filmed in X, etc.)
 * 4. Nature/environment context clues combined with geo signals
 */
function extractLocationSignals(
  comments: string[],
  caption: string,
  bio: string,
  hashtags: string[],
  authorUsername: string,
  creatorComments?: string[], // comments made BY the creator themselves
): LocationSignal[] {
  const signals: LocationSignal[] = [];

  // ── Creator's own comments (highest trust — they KNOW where they are) ─────
  if (creatorComments && creatorComments.length > 0) {
    for (const comment of creatorComments) {
      // Any geo word in creator's own comment = high confidence
      for (const geo of KNOWN_GEO_WORDS) {
        if (new RegExp(`\\b${geo}\\b`, "i").test(comment)) {
          signals.push({
            text: geo,
            source: "creator_reply",
            confidence: "high",
            raw: comment,
          });
        }
      }
      // Answer patterns in creator's comment
      for (const pat of LOCATION_ANSWER_PATTERNS) {
        const m = comment.match(pat);
        if (m?.[1] && m[1].trim().length > 2) {
          signals.push({
            text: m[1].trim(),
            source: "creator_reply",
            confidence: "high",
            raw: comment,
          });
        }
      }
      // Even free-text from creator is valuable — add the full comment
      if (comment.trim().length > 4) {
        signals.push({
          text: comment.trim(),
          source: "creator_reply",
          confidence: "high",
          raw: comment,
        });
      }
    }
  }

  // ── Hashtag signals (most reliable after native tag) ──────────────────────
  for (const tag of hashtags) {
    const lower = tag.toLowerCase();
    // Travel-specific hashtag patterns
    if (
      /^(visit|explore|travel|trip|vacation|holiday|discover)/.test(lower) ||
      /travel$|trip$|life$|vibes?$|mood$/.test(lower)
    )
      continue; // skip generic travel tags

    // Check if any known geo word is in the hashtag
    for (const geo of KNOWN_GEO_WORDS) {
      if (lower.includes(geo.toLowerCase().replace(/\s+/g, ""))) {
        signals.push({
          text: geo,
          source: "hashtag",
          confidence: "high",
          raw: `#${tag}`,
        });
        break;
      }
    }
    // Also accept short hashtags that look like place names (capitalized when un-slugged)
    if (
      tag.length >= 4 &&
      tag.length <= 30 &&
      /^[a-z]/.test(tag) &&
      !/\d/.test(tag)
    ) {
      const unslug = tag.replace(/([A-Z])/g, " $1").trim();
      if (KNOWN_GEO_WORDS.has(unslug)) {
        signals.push({
          text: unslug,
          source: "hashtag",
          confidence: "high",
          raw: `#${tag}`,
        });
      }
    }
  }

  // ── Caption signals ────────────────────────────────────────────────────────
  if (caption) {
    for (const geo of KNOWN_GEO_WORDS) {
      if (new RegExp(`\\b${geo}\\b`, "i").test(caption)) {
        signals.push({
          text: geo,
          source: "caption",
          confidence: "high",
          raw: caption,
        });
      }
    }
    for (const pat of LOCATION_ANSWER_PATTERNS) {
      const m = caption.match(pat);
      if (m?.[1]) {
        signals.push({
          text: m[1].trim(),
          source: "caption",
          confidence: "medium",
          raw: caption,
        });
      }
    }
  }

  // ── Bio signals ────────────────────────────────────────────────────────────
  if (bio) {
    for (const geo of KNOWN_GEO_WORDS) {
      if (new RegExp(`\\b${geo}\\b`, "i").test(bio)) {
        // Bio location is "medium" if it says "based in X" or "from X", else "low"
        const isBased = /\b(based|from|located|living|lives?|home)\b/i.test(
          bio,
        );
        signals.push({
          text: geo,
          source: "bio",
          confidence: isBased ? "medium" : "low",
          raw: bio,
        });
      }
    }
    // Also parse "X based" / "based in X" patterns explicitly
    const basedMatch = bio.match(
      /\b([\w\s]{2,30})\s+based\b|\bbased\s+in\s+([\w\s]{2,30})/i,
    );
    if (basedMatch) {
      const place = (basedMatch[1] || basedMatch[2] || "").trim();
      if (place.length > 2) {
        signals.push({
          text: place,
          source: "bio",
          confidence: "medium",
          raw: bio,
        });
      }
    }
  }

  // ── Comment analysis ───────────────────────────────────────────────────────
  for (const comment of comments) {
    const isQuestion = LOCATION_QUESTION_PATTERNS.some((p) => p.test(comment));

    // Direct geo-word mention in comment
    for (const geo of KNOWN_GEO_WORDS) {
      if (new RegExp(`\\b${geo}\\b`, "i").test(comment)) {
        signals.push({
          text: geo,
          source: "comment_geo",
          // A geo word in a question is weaker (viewer guessing), in a statement is stronger
          confidence: isQuestion ? "low" : "medium",
          raw: comment,
        });
      }
    }

    // Answer pattern in non-question comment
    if (!isQuestion) {
      for (const pat of LOCATION_ANSWER_PATTERNS) {
        const m = comment.match(pat);
        if (m?.[1] && m[1].trim().length > 2) {
          signals.push({
            text: m[1].trim(),
            source: "comment_answer",
            confidence: "medium",
            raw: comment,
          });
        }
      }
    }
  }

  // ── Nature/context clues from ALL text ────────────────────────────────────
  // e.g. "this river" + "Oregon based" bio → hint: "river in Oregon"
  const allText = [caption, bio, ...comments].join(" ");
  const foundNature: string[] = [];
  for (const word of NATURE_CONTEXT_WORDS) {
    if (new RegExp(`\\b${word}\\b`, "i").test(allText)) {
      foundNature.push(word);
    }
  }
  if (foundNature.length > 0) {
    // Add as a context_clue signal — helps AI narrow from region to specific spot
    signals.push({
      text: foundNature.slice(0, 3).join(", "),
      source: "context_clue",
      confidence: "low",
      raw: `Nature context detected: ${foundNature.join(", ")}`,
    });
  }

  // Deduplicate by text (case-insensitive), keep highest confidence
  const seen = new Map<string, LocationSignal>();
  for (const sig of signals) {
    const key = sig.text.toLowerCase();
    const existing = seen.get(key);
    const confRank = { high: 3, medium: 2, low: 1 };
    if (!existing || confRank[sig.confidence] > confRank[existing.confidence]) {
      seen.set(key, sig);
    }
  }

  const sorted = [...seen.values()].sort((a, b) => {
    const r = { high: 3, medium: 2, low: 1 };
    return r[b.confidence] - r[a.confidence];
  });

  return sorted;
}

/**
 * Build composite hints by combining geo signals with nature context clues.
 * e.g. signals contain "Oregon" (medium, bio) + context_clue "river" →
 * produces composite hint "river in Oregon" for the AI.
 */
function buildCompositeHints(
  signals: LocationSignal[],
): CompositeLocationHint[] {
  const hints: CompositeLocationHint[] = [];
  const geoSignals = signals.filter((s) => s.source !== "context_clue");
  const contextSignals = signals.filter((s) => s.source === "context_clue");

  if (geoSignals.length === 0 || contextSignals.length === 0) return hints;

  for (const geo of geoSignals.slice(0, 3)) {
    for (const ctx of contextSignals) {
      const combined = `${ctx.text} in ${geo.text}`;
      hints.push({
        region: geo.text,
        context: ctx.text,
        combined,
        confidence: geo.confidence === "high" ? "medium" : "low",
      });
    }
  }

  return hints;
}

/**
 * Identify which comments were made by the creator themselves.
 * TikTok comment objects include user.unique_id — we match against authorUsername.
 * Also detects likely alt accounts (similar username pattern).
 */
function extractCreatorComments(
  rawComments: any[],
  authorUsername: string,
): string[] {
  if (!authorUsername) return [];

  const lowerAuthor = authorUsername.toLowerCase().replace(/[._-]/g, "");
  const creatorTexts: string[] = [];

  for (const c of rawComments) {
    const uid = (
      c?.user?.unique_id ||
      c?.user?.uniqueId ||
      c?.user?.nickname ||
      ""
    )
      .toLowerCase()
      .replace(/[._-]/g, "");

    if (!uid) continue;

    // Exact match OR username is a substring of the other (alt account detection)
    // e.g. @alexxhinson and @_explorewithalexx both contain "alex"
    const isExact = uid === lowerAuthor;
    const isAlt =
      !isExact &&
      lowerAuthor.length >= 4 &&
      (uid.includes(lowerAuthor.slice(0, 5)) ||
        lowerAuthor.includes(uid.slice(0, 5)));

    if (isExact || isAlt) {
      const text = c?.text || c?.comment_text || c?.content || "";
      if (text.trim().length > 1) {
        creatorTexts.push(text.trim());
        if (isAlt) {
          console.log(
            `[Scraper] Possible creator alt account @${uid} comment: "${text.slice(0, 80)}"`,
          );
        }
      }
    }
  }

  return creatorTexts;
}

/**
 * Separate comments into:
 * - Questions ("where is this?")
 * - Answers / statements (contain place names or answer patterns)
 * - Neutral (neither)
 * Returns only the USEFUL ones for the AI context.
 */
function filterUsefulComments(comments: string[]): {
  answers: string[];
  questions: string[];
} {
  const answers: string[] = [];
  const questions: string[] = [];

  for (const c of comments) {
    const isQ = LOCATION_QUESTION_PATTERNS.some((p) => p.test(c));
    if (isQ) {
      questions.push(c);
      continue;
    }
    // Keep if it has a geo word or answer pattern
    const hasGeo = [...KNOWN_GEO_WORDS].some((g) =>
      new RegExp(`\\b${g}\\b`, "i").test(c),
    );
    const hasAnswerPat = LOCATION_ANSWER_PATTERNS.some((p) => p.test(c));
    if (hasGeo || hasAnswerPat) {
      answers.push(c);
    }
  }

  return { answers, questions };
}

// ─── Types ───────────────────────────────────────────────────────────────────

// ─── Rich Data Interface ──────────────────────────────────────────────────────
export interface RichPostData {
  caption: string;
  hashtags: string[];
  top_comments: string[];
  user_bio: string;
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
  thumbnail: string | null;
  author_username: string;
  platform: "instagram" | "tiktok";
  post_id: string;
  // Optional enrichment fields populated by TikTok scraper
  _creatorComments?: string[];
  _compositeHints?: CompositeLocationHint[];
  _anchorLocations?: string[];
  // Slideshow (photo post) image URLs — first entry doubles as the thumbnail
  _slideImages?: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractHashtagsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/#[\w\u00C0-\u024F\u0400-\u04FF]+/g);
  return matches ? [...new Set(matches.map((h) => h.slice(1)))] : [];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── INSTAGRAM ───────────────────────────────────────────────────────────────

export async function scrapeInstagram(url: string): Promise<RichPostData> {
  const rapidKey = process.env.RAPIDAPI_KEY;
  // We allow proceeding without RAPIDAPI_KEY for free-tier scraping,
  // but warn if it's missing since quality will be lower.
  if (!rapidKey)
    console.warn(
      "RAPIDAPI_KEY is missing — falling back to free oEmbed/HTML scraping.",
    );

  // ── Normalise URL & extract shortcode ─────────────────────────────────────
  const cleanUrl = url.trim().startsWith("http")
    ? url.trim()
    : `https://${url.trim()}`;
  const reelMatch = cleanUrl.match(/\/reel\/([^/?#]+)/);
  const pMatch = cleanUrl.match(/\/p\/([^/?#]+)/);
  const shortcode = reelMatch?.[1] || pMatch?.[1] || "";

  const canonicalUrl = shortcode
    ? `https://www.instagram.com/p/${shortcode}/`
    : cleanUrl;

  let caption = "";
  let thumbnail: string | null = null;
  let hashtags: string[] = [];
  let location_name: string | null = null;
  let location_lat: number | null = null;
  let location_lng: number | null = null;
  let author_username = "";
  let top_comments: string[] = [];
  let user_bio = "";

  // Side-channel accumulators (mirroring TikTok's pattern)
  let _creatorComments: string[] = [];
  let _anchorLocations: string[] = [];

  // ── Layer 0: Free oEmbed (Baseline) ──────────────────────────────────────
  // We try this FIRST so we have at least some data if paid APIs fail/timeout.
  try {
    console.log("[IG L0] Fetching oEmbed baseline…");
    const oembedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(canonicalUrl)}&maxwidth=640`;
    const res = await axios.get(oembedUrl, { timeout: 5000 });

    if (res.data) {
      caption = res.data.title || "";
      thumbnail = res.data.thumbnail_url || null;
      author_username = res.data.author_name || "";
      console.log(
        `[IG L0] oEmbed ✅ | caption: ${caption.length} chars | author: ${author_username}`,
      );
    }
  } catch (e: any) {
    console.warn("[IG L0] oEmbed failed:", e.message);
  }

  // ── Layer 1: instagram-scraper-api2 /v1/post_info (primary, richer data) ──
  // This is the most reliable source for caption, thumbnail, location tag, author.
  if (rapidKey) {
    try {
      console.log("[IG L1] Trying instagram-scraper-api2 /v1/post_info…");
      const res = await axios.get(
        "https://instagram-scraper-api2.p.rapidapi.com/v1/post_info",
        {
          params: { code_or_id_or_url: shortcode || canonicalUrl },
          headers: {
            "x-rapidapi-key": rapidKey,
            "x-rapidapi-host": "instagram-scraper-api2.p.rapidapi.com",
          },
          timeout: 15000,
        },
      );

      const d = res.data?.data || res.data;
      if (d) {
        const rawCaption =
          d?.caption?.text ||
          d?.caption_text ||
          d?.edge_media_to_caption?.edges?.[0]?.node?.text ||
          d?.caption ||
          "";
        if (rawCaption) caption = rawCaption;

        // Thumbnail — cascade through multiple keys
        const imgs =
          d?.image_versions2?.candidates ||
          d?.thumbnail_resources ||
          d?.carousel_media?.[0]?.image_versions2?.candidates ||
          [];
        if (imgs.length > 0) thumbnail = imgs[0]?.url || null;
        if (!thumbnail)
          thumbnail =
            d?.display_url || d?.thumbnail_url || d?.cover_frame_url || null;

        // Native Instagram location tag — the gold standard
        if (d?.location) {
          location_name =
            d.location?.name ||
            d.location?.short_name ||
            d.location?.address_json?.city_name ||
            null;
          location_lat = d.location?.lat ?? null;
          location_lng = d.location?.lng ?? null;
          if (location_name) {
            console.log(`[IG L1] 📍 Native location tag: "${location_name}"`);
            _anchorLocations.push(location_name);
          }
        }

        // Author
        author_username =
          d?.user?.username || d?.owner?.username || d?.account?.username || "";

        // Hashtags
        const captionHashtags = extractHashtagsFromText(rawCaption);
        hashtags = [...new Set([...captionHashtags])];
        if (Array.isArray(d?.hashtags)) {
          hashtags = [
            ...new Set([
              ...hashtags,
              ...d.hashtags.map((h: any) =>
                typeof h === "string" ? h : h?.name || "",
              ),
            ]),
          ].filter(Boolean);
        }

        console.log(
          `[IG L1] instagram-scraper-api2 v1 ✅ | location: ${location_name || "none"} | author: @${author_username} | hashtags: ${hashtags.length} | caption: ${caption.length} chars`,
        );
      } else {
        console.warn(`[IG L1] instagram-scraper-api2 v1: no data in response`);
      }
    } catch (e: any) {
      console.warn("[IG L1] instagram-scraper-api2 v1 failed:", e.message);
    }
  }

  await sleep(300);

  // ── Layer 1.5: instagram-scraper-api2 /v1.1/post_info (alternate version) ──
  // Try the v1.1 endpoint as a supplement — may return richer nested fields.
  if (rapidKey && (!caption || !author_username)) {
    try {
      console.log("[IG L1.5] Trying instagram-scraper-api2 /v1.1/post_info…");
      const res = await axios.get(
        "https://instagram-scraper-api2.p.rapidapi.com/v1.1/post_info",
        {
          params: { code_or_id_or_url: shortcode || canonicalUrl },
          headers: {
            "x-rapidapi-key": rapidKey,
            "x-rapidapi-host": "instagram-scraper-api2.p.rapidapi.com",
          },
          timeout: 15000,
        },
      );

      const d = res.data?.data || res.data;
      if (d) {
        const rawCaption =
          d?.caption?.text ||
          d?.caption_text ||
          d?.edge_media_to_caption?.edges?.[0]?.node?.text ||
          d?.caption ||
          "";
        if (!caption && rawCaption) caption = rawCaption;

        const imgs =
          d?.image_versions2?.candidates ||
          d?.thumbnail_resources ||
          d?.carousel_media?.[0]?.image_versions2?.candidates ||
          [];
        if (!thumbnail && imgs.length > 0) thumbnail = imgs[0]?.url || null;
        if (!thumbnail) thumbnail = d?.display_url || d?.thumbnail_url || null;

        if (!location_name && d?.location) {
          location_name =
            d.location?.name ||
            d.location?.short_name ||
            d.location?.address_json?.city_name ||
            null;
          location_lat = d.location?.lat ?? null;
          location_lng = d.location?.lng ?? null;
          if (location_name && !_anchorLocations.includes(location_name)) {
            _anchorLocations.push(location_name);
            console.log(`[IG L1.5] 📍 Native location tag: "${location_name}"`);
          }
        }

        if (!author_username) {
          author_username =
            d?.user?.username ||
            d?.owner?.username ||
            d?.account?.username ||
            "";
        }

        if (hashtags.length === 0) {
          const captionHashtags = extractHashtagsFromText(
            rawCaption || caption,
          );
          hashtags = [...new Set([...captionHashtags])];
        }

        console.log(
          `[IG L1.5] instagram-scraper-api2 v1.1 ✅ | caption: ${caption.length} chars`,
        );
      }
    } catch (e: any) {
      console.warn("[IG L1.5] instagram-scraper-api2 v1.1 failed:", e.message);
    }
  }

  await sleep(300);

  // ── Layer 1b: instagram120 (RapidAPI fallback) ──────────────────────────
  // Only use if we still have no caption or thumbnail.
  if (rapidKey && (!caption || !thumbnail)) {
    try {
      console.log("[IG L1b] Falling back to instagram120…");
      const res = await axios.post(
        "https://instagram120.p.rapidapi.com/api/instagram/links",
        { url: canonicalUrl },
        {
          headers: {
            "x-rapidapi-key": rapidKey,
            "x-rapidapi-host": "instagram120.p.rapidapi.com",
            "Content-Type": "application/json",
          },
          timeout: 12000,
        },
      );
      const item = Array.isArray(res.data) ? res.data[0] : res.data;
      if (item) {
        if (!caption)
          caption =
            item?.meta?.title || item?.caption || item?.description || "";
        if (!thumbnail)
          thumbnail =
            item?.pictureUrl ||
            item?.thumbnail ||
            item?.image ||
            item?.displayUrl ||
            null;
        if (!author_username)
          author_username = item?.ownerUsername || item?.username || "";
        console.log(
          `[IG L1b] instagram120 ✅ | caption: ${caption.length} chars`,
        );
      }
    } catch (e: any) {
      console.warn("[IG L1b] instagram120 failed:", e.message);
    }
  }

  await sleep(300);

  // ── Layer 1c: HTML Meta Tags (Last Resort) ──────────────────────────────
  // If still no data, try to fetch the page HTML and regex for OG tags.
  if (!caption && !thumbnail) {
    try {
      console.log("[IG L1c] Fetching public HTML for meta tags…");
      // Use a common browser UA to reduce block chance
      const res = await axios.get(canonicalUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        },
        timeout: 8000,
        validateStatus: () => true, // Don't throw on 404/429 so we can log
      });

      if (res.status === 200) {
        const html = res.data as string;

        // Extract Description
        const descMatch =
          html.match(
            /<meta\s+property="og:description"\s+content="([^"]+)"/i,
          ) || html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
        if (descMatch) {
          const rawDesc = descMatch[1];
          // Instagram descriptions often start with "123 Likes, 4 Comments - Username (@handle) on Instagram: "
          // We try to clean that prefix.
          caption = rawDesc
            .replace(/^.*?on Instagram:\s+["“](.*?)["”].*$/, "$1")
            .trim();
          if (!caption) caption = rawDesc;
        }

        // Extract Image
        const imgMatch = html.match(
          /<meta\s+property="og:image"\s+content="([^"]+)"/i,
        );
        if (imgMatch) thumbnail = imgMatch[1];

        // Extract Title for Author
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch) {
          // "User (@handle) • Instagram photos and videos"
          const handleMatch = titleMatch[1].match(/\(@([^)]+)\)/);
          if (handleMatch) author_username = handleMatch[1];
        }

        console.log(
          `[IG L1c] HTML Parse ✅ | caption: ${caption.length} chars | author: ${author_username}`,
        );
      }
    } catch (e: any) {
      console.warn("[IG L1c] HTML meta parse failed:", e.message);
    }
  }

  // Ensure hashtags are extracted from whatever caption we have so far
  if (hashtags.length === 0 && caption)
    hashtags = extractHashtagsFromText(caption);

  // ── Layer 2: Comments (instagram-scraper-api2 /v1.1/comments) ────────────
  // Fetch up to 30 comments, then apply the same smart-filtering TikTok uses.
  let rawCommentItems: any[] = [];
  if (rapidKey) {
    try {
      console.log("[IG L2] Fetching comments via instagram-scraper-api2…");
      const res = await axios.get(
        "https://instagram-scraper-api2.p.rapidapi.com/v1.1/comments",
        {
          params: { code_or_id_or_url: shortcode || canonicalUrl },
          headers: {
            "x-rapidapi-key": rapidKey,
            "x-rapidapi-host": "instagram-scraper-api2.p.rapidapi.com",
          },
          timeout: 15000,
        },
      );

      rawCommentItems =
        res.data?.data?.items ||
        res.data?.items ||
        res.data?.data?.comments ||
        res.data?.comments ||
        [];

      console.log(
        `[IG L2] raw comment items: ${Array.isArray(rawCommentItems) ? rawCommentItems.length : "not array"}`,
      );

      if (Array.isArray(rawCommentItems) && rawCommentItems.length > 0) {
        console.log(
          `[IG L2] first comment keys: ${Object.keys(rawCommentItems[0]).join(", ")}`,
        );

        // ── Extract creator's own comments ────────────────────────────────────
        // Instagram comment objects use { user: { username }, text }
        const creatorOwnComments = extractCreatorComments(
          rawCommentItems.slice(0, 30).map((c: any) => ({
            // Normalise to the same shape extractCreatorComments expects
            user: {
              unique_id: c?.user?.username || c?.owner?.username || "",
              uniqueId: c?.user?.username || c?.owner?.username || "",
              nickname: c?.user?.full_name || "",
            },
            text: c?.text || c?.comment?.text || c?.content || "",
          })),
          author_username,
        );

        if (creatorOwnComments.length > 0) {
          _creatorComments = creatorOwnComments;
          console.log(
            `[IG L2] 🎯 Creator's own comments (${creatorOwnComments.length}):`,
            creatorOwnComments.map((c) => `"${c.slice(0, 80)}"`).join(", "),
          );
        }

        const allCommentTexts = rawCommentItems
          .slice(0, 30)
          .map((c: any) => c?.text || c?.comment?.text || c?.content || "")
          .filter((t: string) => t.trim().length > 2);

        // Smart filter: creator > answers > questions > neutral (same as TikTok)
        const { answers, questions } = filterUsefulComments(allCommentTexts);
        const neutral = allCommentTexts.filter(
          (t) =>
            !_creatorComments.includes(t) &&
            !answers.includes(t) &&
            !questions.includes(t),
        );

        top_comments = [
          ..._creatorComments,
          ...answers,
          ...questions.slice(0, 3),
          ...neutral.slice(0, 4),
        ].slice(0, 15);

        console.log(
          `[IG L2] Comments ✅ | total: ${allCommentTexts.length} | creator: ${_creatorComments.length} | answers: ${answers.length} | questions: ${questions.length} | kept: ${top_comments.length}`,
        );
      } else {
        console.warn(`[IG L2] 0 comments returned`);
      }
    } catch (e: any) {
      console.warn("[IG L2] Comments failed:", e.message);
    }
  }

  await sleep(300);

  // ── Layer 2.1: Fetch reply threads for comments that have replies ─────────
  // Creators almost always answer "where is this?" in a reply thread.
  // instagram-scraper-api2 supports /v1/comments/replies?comment_id=...
  if (rawCommentItems.length > 0 && author_username) {
    const commentsWithReplies = rawCommentItems
      .slice(0, 30)
      .filter((c: any) => (c?.reply_count || c?.child_comment_count || 0) > 0);

    if (commentsWithReplies.length > 0) {
      console.log(
        `[IG L2.1] ${commentsWithReplies.length} comment(s) have replies — fetching threads…`,
      );

      const allReplyTexts: string[] = [];
      const creatorReplyTexts: string[] = [];

      for (const parentComment of commentsWithReplies.slice(0, 5)) {
        const commentId =
          parentComment?.id ||
          parentComment?.pk ||
          parentComment?.comment_id ||
          "";
        if (!commentId) continue;

        try {
          const replyRes = await axios.get(
            "https://instagram-scraper-api2.p.rapidapi.com/v1/comments/replies",
            {
              params: {
                comment_id: commentId,
                code_or_id_or_url: shortcode || canonicalUrl,
              },
              headers: {
                "x-rapidapi-key": rapidKey,
                "x-rapidapi-host": "instagram-scraper-api2.p.rapidapi.com",
              },
              timeout: 12000,
            },
          );

          const replies: any[] =
            replyRes.data?.data?.items ||
            replyRes.data?.items ||
            replyRes.data?.data?.replies ||
            replyRes.data?.replies ||
            (Array.isArray(replyRes.data?.data) ? replyRes.data.data : []) ||
            [];

          const parentText =
            parentComment?.text?.slice(0, 50) ||
            parentComment?.comment?.text?.slice(0, 50) ||
            "";
          console.log(
            `[IG L2.1] Thread for "${parentText}" → ${replies.length} replies`,
          );

          for (const reply of replies) {
            const replyText: string =
              reply?.text || reply?.comment?.text || reply?.content || "";
            if (!replyText.trim()) continue;

            const replyUser: string = (
              reply?.user?.username ||
              reply?.owner?.username ||
              ""
            ).toLowerCase();

            allReplyTexts.push(replyText);

            // Check if this reply is from the creator
            const lowerAuthor = author_username
              .toLowerCase()
              .replace(/[._-]/g, "");
            const cleanReplyUser = replyUser.replace(/[._-]/g, "");
            const isCreator =
              cleanReplyUser === lowerAuthor ||
              (lowerAuthor.length >= 4 &&
                (cleanReplyUser.includes(lowerAuthor.slice(0, 5)) ||
                  lowerAuthor.includes(cleanReplyUser.slice(0, 5))));

            if (isCreator) {
              creatorReplyTexts.push(replyText);
              console.log(
                `[IG L2.1] 🎯 CREATOR REPLY [@${replyUser}]: "${replyText}"`,
              );
            } else {
              console.log(
                `[IG L2.1]   [@${replyUser}]: "${replyText.slice(0, 80)}"`,
              );
            }
          }

          await sleep(200);
        } catch (replyErr: any) {
          console.warn(
            `[IG L2.1] Reply fetch error for comment ${commentId}:`,
            replyErr.message,
          );
        }
      }

      // Merge creator replies to front of _creatorComments
      if (creatorReplyTexts.length > 0) {
        _creatorComments = [...creatorReplyTexts, ..._creatorComments];
        console.log(
          `[IG L2.1] ✅ Found ${creatorReplyTexts.length} creator reply(ies) — prepended`,
        );
      }

      // Rebuild top_comments with reply content, creator first
      if (allReplyTexts.length > 0) {
        const replyAnswers = allReplyTexts.filter(
          (t) => !creatorReplyTexts.includes(t),
        );
        top_comments = [
          ..._creatorComments,
          ...replyAnswers.slice(0, 5),
          ...top_comments.filter((t) => !_creatorComments.includes(t)),
        ].slice(0, 20);

        console.log(
          `[IG L2.1] top_comments after reply merge: ${top_comments.length} (${_creatorComments.length} creator)`,
        );
      }
    } else {
      console.log(`[IG L2.1] No reply threads to fetch`);
    }
  }

  await sleep(300);

  // ── Layer 2.5: Pre-extract location signals ───────────────────────────────
  // Run extractLocationSignals early (before bio) to guide logging & fallback.
  const earlySignals = extractLocationSignals(
    top_comments,
    caption,
    "",
    hashtags,
    author_username,
    _creatorComments,
  );
  if (earlySignals.length > 0) {
    console.log(
      `[IG L2.5] Pre-extraction found ${earlySignals.length} location signal(s):`,
    );
    earlySignals
      .slice(0, 6)
      .forEach((s) =>
        console.log(
          `  [${s.confidence}] "${s.text.slice(0, 80)}" (from ${s.source})`,
        ),
      );
  } else {
    console.log(`[IG L2.5] No signals yet — bio may help`);
  }

  // ── Layer 3: User Bio (instagram-scraper-api2 /v1.1/info) ────────────────
  if (rapidKey && author_username) {
    try {
      console.log(`[IG L3] Fetching bio for @${author_username}…`);
      const res = await axios.get(
        "https://instagram-scraper-api2.p.rapidapi.com/v1.1/info",
        {
          params: { username: author_username },
          headers: {
            "x-rapidapi-key": rapidKey,
            "x-rapidapi-host": "instagram-scraper-api2.p.rapidapi.com",
          },
          timeout: 12000,
        },
      );

      const d = res.data?.data || res.data;
      user_bio = d?.biography || d?.bio || d?.description || "";

      // Extra location signals: bio_links, category, city
      const bioLinks = (d?.bio_links || [])
        .map((l: any) => l?.url || "")
        .join(" ");
      const category = d?.category_name || d?.category || "";
      const city = d?.city_name || d?.city || "";
      const extras = [bioLinks, category, city].filter(Boolean).join(" | ");
      if (extras) user_bio = `${user_bio} [${extras}]`.trim();

      console.log(
        `[IG L3] User bio ✅ (${user_bio.length} chars)${city ? ` | city: ${city}` : ""}`,
      );
    } catch (e: any) {
      console.warn("[IG L3] User bio failed:", e.message);
    }
  }

  // ── Final location signal extraction (full, with bio) ────────────────────
  const finalSignals = extractLocationSignals(
    top_comments,
    caption,
    user_bio,
    hashtags,
    author_username,
    _creatorComments,
  );

  // Build composite hints (geo region + nature context clue)
  const _compositeHints = buildCompositeHints(finalSignals);

  // ── Derive best location_name from signals if no native tag ───────────────
  // Priority: native GPS tag > anchor location > creator reply > best signal
  let derivedLocation: string | null = location_name;

  if (!derivedLocation && _anchorLocations.length > 0) {
    derivedLocation = _anchorLocations[0];
    console.log(`[IG FINAL] Using anchor location: "${derivedLocation}"`);
  }

  if (!derivedLocation && _creatorComments.length > 0) {
    const creatorGeoSignal = finalSignals.find(
      (s) => s.source === "creator_reply",
    );
    if (creatorGeoSignal) {
      derivedLocation = creatorGeoSignal.text;
      console.log(
        `[IG FINAL] Derived from creator reply: "${derivedLocation}"`,
      );
    }
  }

  if (!derivedLocation && finalSignals.length > 0) {
    const best = finalSignals.find((s) => s.source !== "context_clue");
    if (best && (best.confidence === "high" || best.confidence === "medium")) {
      const cleanPlace = extractPlaceFromText(best.raw || best.text);
      derivedLocation = cleanPlace || null;
      console.log(
        `[IG FINAL] Derived location from ${best.source}: "${derivedLocation}" (${best.confidence})`,
      );
    }
  }

  // Final summary log (mirrors TikTok)
  console.log(
    `[IG FINAL] caption: ${caption.length} chars | hashtags: ${hashtags.length} | comments: ${top_comments.length} | creator_comments: ${_creatorComments.length} | bio: ${user_bio.length} chars | native_tag: ${location_name || "none"} | anchor: ${_anchorLocations[0] || "none"} | derived: ${derivedLocation || "none"} | signals: ${finalSignals.length} | composite_hints: ${_compositeHints.length} | thumbnail: ${thumbnail ? "✅" : "❌"}`,
  );

  return {
    caption,
    hashtags,
    top_comments,
    user_bio,
    location_name: derivedLocation,
    location_lat,
    location_lng,
    thumbnail,
    author_username,
    platform: "instagram",
    post_id: shortcode,
    // Extra fields consumed by the pipeline & AI context builder
    _creatorComments,
    _compositeHints,
    _anchorLocations,
  } as any;
}

// ─── TIKTOK ──────────────────────────────────────────────────────────────────

// Export the pre-processor so the engine + AI layer can use it
export {
  extractLocationSignals,
  filterUsefulComments,
  extractCreatorComments,
  buildCompositeHints,
};
export type { LocationSignal, CompositeLocationHint };

export async function scrapeTikTok(url: string): Promise<RichPostData> {
  const rapidKey = process.env.RAPIDAPI_KEY;

  let caption = "";
  let thumbnail: string | null = null;
  let hashtags: string[] = [];
  let top_comments: string[] = [];
  let user_bio = "";
  let video_id =
    url.match(/\/(?:video|photo)\/(\d+)/)?.[1] ||
    url.split(/\/(?:video|photo)\//)[1]?.split("?")[0] ||
    "";

  // Photo posts (image slideshows) live at /photo/<id> instead of /video/<id>.
  // Short vm./vt. links don't reveal the type — tikwm's `images` array flips
  // this to "photo" later in that case.
  let contentType: "video" | "photo" = /\/photo\//.test(url)
    ? "photo"
    : "video";
  let slideImages: string[] = [];

  // Extract username from URL upfront — works for both:
  //   https://www.tiktok.com/@alexxhinson/video/123
  //   https://vm.tiktok.com/ZMxxxxx/ (short links — username not in URL, set after L1)
  let author_username = url.match(/tiktok\.com\/@([^/?#]+)/)?.[1] || "";

  // Reconstruct a clean canonical TikTok URL — tiktok-scraper7 needs the full URL
  // e.g. https://www.tiktok.com/@username/video/1234567890
  // If we have username + video_id we can build it; otherwise fall back to the raw url
  function buildCanonicalUrl(
    username: string,
    vid: string,
    rawUrl: string,
    kind: "video" | "photo" = "video",
  ): string {
    if (username && vid)
      return `https://www.tiktok.com/@${username}/${kind}/${vid}`;
    if (vid) return `https://www.tiktok.com/${kind}/${vid}`;
    return rawUrl;
  }

  // ── Layer 1: tikwm.com — free API, no key, 5 000 req/day per IP ──────────
  try {
    console.log("[TT L1] Trying tikwm.com free API…");
    const params = new URLSearchParams({ url, hd: "0" });
    const res = await axios.post("https://www.tikwm.com/api/", params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15000,
    });

    const d = res.data?.data;
    if (d && res.data?.code === 0) {
      caption = d.title || "";
      thumbnail = d.cover || d.origin_cover || d.ai_dynamic_cover || null;
      author_username =
        d.author?.unique_id || d.author?.uniqueId || d.author?.uid || "";
      if (!video_id) video_id = String(d.id || "");

      // Photo slideshows: tikwm returns the slides in `images` and the
      // `cover` is often a collage — prefer the first slide as thumbnail
      if (Array.isArray(d.images) && d.images.length > 0) {
        contentType = "photo";
        slideImages = d.images.filter(Boolean).slice(0, 10);
        if (slideImages[0]) thumbnail = slideImages[0];
        console.log(
          `[TT L1] 🖼️ Photo slideshow detected: ${slideImages.length} slides`,
        );
      }

      // tikwm returns hashtag list as array of objects { id, name, title }
      if (Array.isArray(d.hashtag) && d.hashtag.length > 0) {
        hashtags = d.hashtag
          .map((t: any) =>
            typeof t === "string" ? t : t?.name || t?.title || "",
          )
          .filter(Boolean);
      }

      // content_desc may contain anchor tags (mentions, hashtags, locations)
      if (Array.isArray(d.content_desc) && d.content_desc.length > 0) {
        const anchorTags = d.content_desc
          .filter((a: any) => a?.type === 1 || a?.hashtag_name || a?.name)
          .map((a: any) => a?.hashtag_name || a?.name || "")
          .filter(Boolean);
        if (anchorTags.length > 0) {
          hashtags = [...new Set([...hashtags, ...anchorTags])];
          console.log(`[TT L1] content_desc anchors: ${anchorTags.join(", ")}`);
        }
      }

      // Also check anchors field (some tikwm versions use this)
      if (Array.isArray(d.anchors) && d.anchors.length > 0) {
        const anchorLocations = d.anchors
          .filter((a: any) => a?.type === "location" || a?.keyword)
          .map((a: any) => a?.keyword || a?.name || "")
          .filter(Boolean);
        if (anchorLocations.length > 0) {
          console.log(
            `[TT L1] 📍 Anchor locations: ${anchorLocations.join(", ")}`,
          );
          // Treat anchor keywords as high-confidence location tags
          anchorLocations.forEach((loc: string) => {
            (scrapeTikTok as any)._anchorLocations =
              (scrapeTikTok as any)._anchorLocations || [];
            (scrapeTikTok as any)._anchorLocations.push(loc);
          });
        }
      }

      // Always also parse caption text for hashtags as a supplement
      const captionTags = extractHashtagsFromText(caption);
      hashtags = [...new Set([...hashtags, ...captionTags])];

      console.log(
        `[TT L1] tikwm.com ✅ | video_id: ${video_id} | author: @${author_username} | hashtags: ${hashtags.length} | caption: ${caption.length} chars`,
      );
    } else {
      console.warn(
        `[TT L1] tikwm.com returned code ${res.data?.code}: ${res.data?.msg}`,
      );
    }
  } catch (e: any) {
    console.warn("[TT L1] tikwm.com failed:", e.message);
  }

  // Fallback: TikTok oEmbed (completely free, no key) if tikwm gave us nothing
  if (!caption && !thumbnail) {
    try {
      console.log("[TT L1b] Falling back to TikTok oEmbed…");
      const res = await axios.get(
        `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
        { timeout: 10000 },
      );
      caption = res.data.title || "";
      thumbnail = res.data.thumbnail_url || null;
      author_username = res.data.author_name?.replace("@", "") || "";
      if (!video_id)
        video_id = url.split(/\/(?:video|photo)\//)[1]?.split("?")[0] || "";
      const captionTags = extractHashtagsFromText(caption);
      hashtags = [...new Set([...hashtags, ...captionTags])];
      console.log(
        `[TT L1b] oEmbed fallback ✅ | caption: ${caption.length} chars`,
      );
    } catch (e2: any) {
      console.warn("[TT L1b] oEmbed fallback also failed:", e2.message);
    }
  }

  await sleep(300);

  // ── Layer 1.5: tiktok-scraper7 /video/info — richer caption, hashtags, POI ─
  // tiktok-scraper7 requires the FULL url param, not video_id
  const canonicalUrl = buildCanonicalUrl(
    author_username,
    video_id,
    url,
    contentType,
  );
  if (rapidKey && (video_id || url)) {
    try {
      console.log(
        `[TT L1.5] Fetching full video info via tiktok-scraper7 | url: ${canonicalUrl}`,
      );
      const res = await axios.get(
        "https://tiktok-scraper7.p.rapidapi.com/video/info",
        {
          params: { url: canonicalUrl },
          headers: {
            "x-rapidapi-key": rapidKey,
            "x-rapidapi-host": "tiktok-scraper7.p.rapidapi.com",
          },
          timeout: 15000,
        },
      );

      const d = res.data?.data || res.data?.result || null;
      console.log(
        `[TT L1.5] response code: ${res.data?.code} | data keys: ${Object.keys(d || {}).join(", ")}`,
      );

      if (d) {
        // Full description — tiktok-scraper7 uses `desc`, tikwm uses `title`
        const fullDesc =
          d.desc ||
          d.video_description ||
          d.title ||
          d.item_info?.video?.desc ||
          "";
        if (fullDesc.length > caption.length) {
          caption = fullDesc;
          console.log(
            `[TT L1.5] Using richer caption (${caption.length} chars)`,
          );
        }

        // Photo slideshows: aweme-style responses expose slides via image_post_info
        const imagePost =
          d.image_post_info || d.item_info?.image_post_info || null;
        if (Array.isArray(imagePost?.images) && imagePost.images.length > 0) {
          contentType = "photo";
          const urls = imagePost.images
            .map(
              (img: any) =>
                img?.display_image?.url_list?.[0] ||
                img?.owner_watermark_image?.url_list?.[0] ||
                "",
            )
            .filter(Boolean);
          if (urls.length > 0 && slideImages.length === 0) {
            slideImages = urls.slice(0, 10);
            console.log(
              `[TT L1.5] 🖼️ Photo slideshow via image_post_info: ${slideImages.length} slides`,
            );
          }
          if (!thumbnail && slideImages[0]) thumbnail = slideImages[0];
        }

        // Better thumbnail sources from nested video object
        if (!thumbnail) {
          thumbnail =
            d.video?.cover?.url_list?.[0] ||
            d.video?.dynamic_cover?.url_list?.[0] ||
            d.video?.origin_cover?.url_list?.[0] ||
            d.cover_url ||
            slideImages[0] ||
            null;
        }

        // Hashtags: challenges array OR textExtra array (both used by TikTok API)
        const challengeTags: string[] = [
          ...(d.challenges || []),
          ...(d.textExtra || []),
          ...(d.text_extra || []),
        ]
          .map(
            (c: any) =>
              c?.hashtagName || c?.hashtag_name || c?.title || c?.name || "",
          )
          .filter(Boolean);

        const descTags = extractHashtagsFromText(caption);
        hashtags = [...new Set([...hashtags, ...challengeTags, ...descTags])];

        // POI / location — some TikTok videos carry poi_info with name + address
        const poi = d.poi_info || d.poi || d.location || null;
        if (poi) {
          const poiName =
            poi.poi_name || poi.name || poi.address || poi.city || null;
          if (poiName) {
            console.log(`[TT L1.5] 📍 POI detected: "${poiName}"`);
            // Store in a side-channel var — returned as location_name below
            (scrapeTikTok as any)._lastPoi = poiName;
          }
        }

        // Author fallback
        if (!author_username) {
          author_username =
            d.author?.unique_id ||
            d.author?.uniqueId ||
            d.item_info?.author?.unique_id ||
            "";
        }

        // Update video_id if still missing
        if (!video_id) {
          video_id = String(d.id || d.aweme_id || "");
        }

        console.log(
          `[TT L1.5] tiktok-scraper7 video/info ✅ | hashtags: ${hashtags.length} | caption: ${caption.length} chars | poi: ${poi ? "yes" : "no"}`,
        );
      } else {
        console.warn(
          `[TT L1.5] tiktok-scraper7 video/info: no data in response (code: ${res.data?.code}, msg: ${res.data?.msg})`,
        );
      }
    } catch (e: any) {
      console.warn("[TT L1.5] tiktok-scraper7 video/info failed:", e.message);
    }
  }

  await sleep(300);

  // ── Layer 2: Comments ─────────────────────────────────────────────────────
  // tiktok-scraper7 /comment/list requires `url` (full TikTok URL), NOT video_id
  const commentUrl = buildCanonicalUrl(
    author_username,
    video_id,
    url,
    contentType,
  );
  if (rapidKey && (video_id || url)) {
    try {
      console.log(`[TT L2] Fetching comments | url: ${commentUrl}`);
      const res = await axios.get(
        "https://tiktok-scraper7.p.rapidapi.com/comment/list",
        {
          params: { url: commentUrl, count: "30" },
          headers: {
            "x-rapidapi-key": rapidKey,
            "x-rapidapi-host": "tiktok-scraper7.p.rapidapi.com",
          },
          timeout: 15000,
        },
      );

      console.log(`[TT L2] code: ${res.data?.code} | msg: ${res.data?.msg}`);

      const rawComments =
        res.data?.data?.comments ||
        res.data?.data?.comment_list ||
        res.data?.comments ||
        (Array.isArray(res.data?.data) ? res.data.data : null) ||
        [];

      console.log(
        `[TT L2] raw comments: ${Array.isArray(rawComments) ? rawComments.length : "not array"}`,
      );

      if (Array.isArray(rawComments) && rawComments.length > 0) {
        console.log(
          `[TT L2] first comment keys: ${Object.keys(rawComments[0]).join(", ")}`,
        );
        // Extract creator's own comments FIRST — highest trust signal
        const creatorOwnComments = extractCreatorComments(
          rawComments.slice(0, 30),
          author_username,
        );
        if (creatorOwnComments.length > 0) {
          console.log(
            `[TT L2] 🎯 Creator's own comments (${creatorOwnComments.length}):`,
            creatorOwnComments.map((c) => `"${c.slice(0, 80)}"`).join(", "),
          );
        }

        const allCommentTexts = rawComments
          .slice(0, 30)
          .map(
            (c: any) =>
              c?.text ||
              c?.comment_text ||
              c?.content ||
              c?.share_info?.desc ||
              "",
          )
          .filter((t: string) => t.trim().length > 2);

        // Smart filter: prioritise creator comments > answer-type > questions > neutral
        const { answers, questions } = filterUsefulComments(allCommentTexts);
        const neutral = allCommentTexts.filter(
          (t) =>
            !creatorOwnComments.includes(t) &&
            !answers.includes(t) &&
            !questions.includes(t),
        );
        top_comments = [
          ...creatorOwnComments, // creator's own replies = highest priority
          ...answers, // comments naming a place
          ...questions.slice(0, 3), // a few location questions for context
          ...neutral.slice(0, 4), // general neutral comments
        ].slice(0, 15);

        // Store creator comments separately for signal extraction
        (scrapeTikTok as any)._creatorComments = creatorOwnComments;

        console.log(
          `[TT L2] Comments ✅ | total: ${allCommentTexts.length} | creator: ${creatorOwnComments.length} | answers: ${answers.length} | questions: ${questions.length} | kept: ${top_comments.length}`,
        );

        // ── Layer 2.1: Fetch reply threads for comments that have replies ────
        // The creator almost always answers "where is this?" in a reply thread.
        // Endpoint: GET tiktok-scraper7 /comment/reply
        // Params: { comment_id, video_id, count }  ← confirmed working via diagnostics
        if (rapidKey && video_id) {
          const commentsWithReplies = rawComments
            .slice(0, 30)
            .filter((c: any) => (c?.reply_total || 0) > 0);

          if (commentsWithReplies.length > 0) {
            console.log(
              `[TT L2.1] ${commentsWithReplies.length} comment(s) have replies — fetching threads…`,
            );

            const allReplyTexts: string[] = [];
            const creatorReplyTexts: string[] = [];

            for (const parentComment of commentsWithReplies.slice(0, 5)) {
              try {
                const replyRes = await axios.get(
                  "https://tiktok-scraper7.p.rapidapi.com/comment/reply",
                  {
                    params: {
                      comment_id: parentComment.id,
                      video_id,
                      count: "20",
                    },
                    headers: {
                      "x-rapidapi-key": rapidKey,
                      "x-rapidapi-host": "tiktok-scraper7.p.rapidapi.com",
                    },
                    timeout: 12000,
                  },
                );

                if (replyRes.data?.code === 0) {
                  const replies: any[] =
                    replyRes.data?.data?.comments ||
                    replyRes.data?.data?.replies ||
                    (Array.isArray(replyRes.data?.data)
                      ? replyRes.data.data
                      : []) ||
                    [];

                  console.log(
                    `[TT L2.1] Thread for comment "${parentComment.text?.slice(0, 50)}" → ${replies.length} replies`,
                  );

                  for (const reply of replies) {
                    const replyText: string =
                      reply?.text ||
                      reply?.comment_text ||
                      reply?.content ||
                      "";
                    if (!replyText.trim()) continue;

                    const replyUser: string = (
                      reply?.user?.unique_id ||
                      reply?.user?.uniqueId ||
                      ""
                    ).toLowerCase();

                    allReplyTexts.push(replyText);

                    // Check if this reply is from the creator
                    const lowerAuthor = author_username
                      .toLowerCase()
                      .replace(/[._-]/g, "");
                    const cleanReplyUser = replyUser.replace(/[._-]/g, "");
                    const isCreator =
                      cleanReplyUser === lowerAuthor ||
                      (lowerAuthor.length >= 4 &&
                        (cleanReplyUser.includes(lowerAuthor.slice(0, 5)) ||
                          lowerAuthor.includes(cleanReplyUser.slice(0, 5))));

                    if (isCreator) {
                      creatorReplyTexts.push(replyText);
                      console.log(
                        `[TT L2.1] 🎯 CREATOR REPLY [@${replyUser}]: "${replyText}"`,
                      );
                    } else {
                      console.log(
                        `[TT L2.1]   [@${replyUser}]: "${replyText.slice(0, 80)}"`,
                      );
                    }
                  }
                } else {
                  console.warn(
                    `[TT L2.1] Reply fetch failed for comment ${parentComment.id}: code ${replyRes.data?.code}`,
                  );
                }

                await sleep(200);
              } catch (replyErr: any) {
                console.warn(
                  `[TT L2.1] Reply fetch error for comment ${parentComment.id}:`,
                  replyErr.message,
                );
              }
            }

            // Merge creator replies into creatorOwnComments (highest priority)
            if (creatorReplyTexts.length > 0) {
              const existingCreator: string[] =
                (scrapeTikTok as any)._creatorComments || [];
              (scrapeTikTok as any)._creatorComments = [
                ...creatorReplyTexts,
                ...existingCreator,
              ];
              console.log(
                `[TT L2.1] ✅ Found ${creatorReplyTexts.length} creator reply(ies) — prepended to creator comments`,
              );
            }

            // Merge all reply texts (non-creator too) into top_comments, prepending creator ones
            const mergedCreator: string[] =
              (scrapeTikTok as any)._creatorComments || [];
            const replyAnswers = allReplyTexts.filter(
              (t) => !creatorReplyTexts.includes(t),
            );

            // Rebuild top_comments with replies included, creator replies first
            top_comments = [
              ...mergedCreator,
              ...replyAnswers.slice(0, 5),
              ...top_comments.filter((t) => !mergedCreator.includes(t)),
            ].slice(0, 20);

            console.log(
              `[TT L2.1] top_comments after reply merge: ${top_comments.length} (${mergedCreator.length} creator)`,
            );
          } else {
            console.log(`[TT L2.1] No reply threads to fetch`);
          }
        }
      } else {
        console.warn(`[TT L2] 0 comments — trying tikwm fallback…`);
        // Fallback A: tikwm POST /api/comment/list (needs url param)
        try {
          const params = new URLSearchParams({ url: commentUrl, count: "20" });
          const res2 = await axios.post(
            "https://www.tikwm.com/api/comment/list",
            params,
            {
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              timeout: 12000,
            },
          );
          console.log(`[TT L2b] tikwm comment code: ${res2.data?.code}`);
          const rawC =
            res2.data?.data?.comments ||
            res2.data?.comments ||
            (Array.isArray(res2.data?.data) ? res2.data.data : []) ||
            [];
          top_comments = (Array.isArray(rawC) ? rawC : [])
            .slice(0, 15)
            .map((c: any) => c?.text || c?.content || "")
            .filter((t: string) => t.trim().length > 2);
          console.log(
            `[TT L2b] tikwm comments ✅ (${top_comments.length} comments)`,
          );
        } catch (e2: any) {
          console.warn("[TT L2b] tikwm comment fallback failed:", e2.message);
        }
      }
    } catch (e: any) {
      console.warn("[TT L2] comments failed:", e.message);
    }
  }

  await sleep(300);

  // ── Layer 2.5: Pre-extract location signals ───────────────────────────────
  const creatorComments: string[] =
    (scrapeTikTok as any)._creatorComments || [];
  const earlySignals = extractLocationSignals(
    top_comments,
    caption,
    "",
    hashtags,
    author_username,
    creatorComments,
  );
  if (earlySignals.length > 0) {
    console.log(
      `[TT L2.5] Pre-extraction found ${earlySignals.length} location signal(s):`,
    );
    earlySignals
      .slice(0, 6)
      .forEach((s) =>
        console.log(
          `  [${s.confidence}] "${s.text.slice(0, 80)}" (from ${s.source})`,
        ),
      );
  } else {
    console.log(`[TT L2.5] No location signals found yet — bio may help`);
  }

  // ── Layer 3: User Bio ─────────────────────────────────────────────────────
  if (author_username) {
    try {
      console.log(
        `[TT L3] Fetching TikTok bio for @${author_username} via tikwm POST…`,
      );
      // tikwm /api/user/detail requires POST with form data, not GET query params
      const params = new URLSearchParams({ unique_id: author_username });
      const res = await axios.post(
        "https://www.tikwm.com/api/user/detail",
        params,
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeout: 12000,
        },
      );

      console.log(`[TT L3] tikwm user detail code: ${res.data?.code}`);
      const u =
        res.data?.data?.user || res.data?.user || res.data?.data || null;

      if (u && res.data?.code === 0) {
        user_bio = u.signature || u.bio || u.desc || "";
        const bioLink = u.bioLink?.link || u.bio_url || "";
        if (bioLink) user_bio = `${user_bio} [bio link: ${bioLink}]`.trim();
        console.log(`[TT L3] tikwm user bio ✅ (${user_bio.length} chars)`);
      } else {
        console.warn(
          `[TT L3] tikwm user detail code: ${res.data?.code} — no user data`,
        );
      }
    } catch (e: any) {
      console.warn("[TT L3] tikwm user bio failed:", e.message);
    }

    // Fallback: tiktok-scraper7 user info endpoint
    if (!user_bio && rapidKey) {
      try {
        console.log("[TT L3b] Falling back to tiktok-scraper7 user/info…");
        const res = await axios.get(
          "https://tiktok-scraper7.p.rapidapi.com/user/info",
          {
            params: { unique_id: author_username },
            headers: {
              "x-rapidapi-key": rapidKey,
              "x-rapidapi-host": "tiktok-scraper7.p.rapidapi.com",
            },
            timeout: 12000,
          },
        );
        const u =
          res.data?.data?.user?.user ||
          res.data?.data?.user ||
          res.data?.user ||
          null;
        if (u) {
          user_bio = u.signature || u.bio || u.desc || "";
          console.log(
            `[TT L3b] tiktok-scraper7 user bio ✅ (${user_bio.length} chars)`,
          );
        }
      } catch (e2: any) {
        console.warn(
          "[TT L3b] tiktok-scraper7 user bio also failed:",
          e2.message,
        );
      }
    }
  }

  // Grab POI if Layer 1.5 found one
  const detectedPoi: string | null = (scrapeTikTok as any)._lastPoi || null;
  const anchorLocations: string[] =
    (scrapeTikTok as any)._anchorLocations || [];
  const finalCreatorComments: string[] =
    (scrapeTikTok as any)._creatorComments || [];
  delete (scrapeTikTok as any)._lastPoi;
  delete (scrapeTikTok as any)._anchorLocations;
  delete (scrapeTikTok as any)._creatorComments;

  // ── Final location signal extraction (full, with bio now included) ────────
  const finalSignals = extractLocationSignals(
    top_comments,
    caption,
    user_bio,
    hashtags,
    author_username,
    finalCreatorComments,
  );

  // Build composite hints (geo region + nature context clue)
  const compositeHints = buildCompositeHints(finalSignals);

  // Build a location_name from signals if no POI tag
  // Priority: POI tag > anchor location > creator reply > high/medium signal
  let derivedLocation: string | null = detectedPoi;

  if (!derivedLocation && anchorLocations.length > 0) {
    derivedLocation = anchorLocations[0];
    console.log(`[TT FINAL] Using anchor location: "${derivedLocation}"`);
  }

  if (!derivedLocation && finalCreatorComments.length > 0) {
    // Check if any creator comment contains a geo word
    const creatorGeoSignal = finalSignals.find(
      (s) => s.source === "creator_reply",
    );
    if (creatorGeoSignal) {
      derivedLocation = creatorGeoSignal.text;
      console.log(
        `[TT FINAL] Derived from creator reply: "${derivedLocation}"`,
      );
    }
  }

  if (!derivedLocation && finalSignals.length > 0) {
    const best = finalSignals.find((s) => s.source !== "context_clue");
    if (best && (best.confidence === "high" || best.confidence === "medium")) {
      const cleanPlace = extractPlaceFromText(best.raw || best.text);
      derivedLocation = cleanPlace || null;
      console.log(
        `[TT FINAL] Derived location from ${best.source}: "${derivedLocation}" (${best.confidence})`,
      );
    }
  }

  // Final summary
  console.log(
    `[TT FINAL] caption: ${caption.length} chars | hashtags: ${hashtags.length} | comments: ${top_comments.length} | creator_comments: ${finalCreatorComments.length} | bio: ${user_bio.length} chars | poi: ${detectedPoi || "none"} | anchor: ${anchorLocations[0] || "none"} | derived: ${derivedLocation || "none"} | signals: ${finalSignals.length} | composite_hints: ${compositeHints.length} | thumbnail: ${thumbnail ? "✅" : "❌"}`,
  );

  // Attach signals and hints to return value for AI context builder
  (scrapeTikTok as any)._lastSignals = finalSignals;
  (scrapeTikTok as any)._lastCompositeHints = compositeHints;
  (scrapeTikTok as any)._lastCreatorComments = finalCreatorComments;

  return {
    caption,
    hashtags,
    top_comments,
    user_bio,
    location_name: derivedLocation, // POI tag OR best derived signal
    location_lat: null,
    location_lng: null,
    thumbnail,
    author_username,
    platform: "tiktok",
    post_id: video_id,
    // Extra fields for AI context (non-standard, consumed by ai.ts)
    _creatorComments: finalCreatorComments,
    _compositeHints: compositeHints,
    _anchorLocations: anchorLocations,
    _slideImages: slideImages.length > 0 ? slideImages : undefined,
  } as any;
}
