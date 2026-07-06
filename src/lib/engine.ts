/**
 * @fileoverview Main Orchestration Engine — `processPost()`
 *
 * This module is the top-level entry point for turning a raw Instagram or
 * TikTok URL into a fully-resolved `EngineResult` containing geocoded travel
 * spots. It is called by `/api/analyze` and the Telegram bot webhook.
 *
 * ## Flow Overview
 *
 * ```
 * processPost(url)
 *   │
 *   ├─ 1. Detect platform (Instagram | TikTok)
 *   ├─ 2. Extract post ID for cache key
 *   ├─ 3. Check Firestore cache (CACHE_TTL_DAYS)
 *   │       └─ HIT → return cached EngineResult immediately
 *   │
 *   ├─ 4. Scrape post data
 *   │       ├─ scrapeInstagram()  (4-layer fallback)
 *   │       └─ scrapeTikTok()     (tikwm + tiktok-scraper7 fallbacks)
 *   │
 *   ├─ 5. Build LocationSignals from RichPostData
 *   │
 *   ├─ 6. NEW PATH — Location Pipeline (Stages 1–5)
 *   │       ├─ Stage 1: Zero-compute extractor
 *   │       ├─ Stage 2: Multi-API geocoding cascade
 *   │       ├─ Stage 3: Wikipedia + KG verification  (parallel with Stage 2)
 *   │       ├─ Stage 4: Google Vision landmark detection (parallel)
 *   │       └─ Stage 5: GPT-5 AI agent (only if confidence < 0.60)
 *   │           │
 *   │           └─ SUCCESS → locationResultToSpot() → AI-enhance category/vibe
 *   │                         → saveToCache() → return EngineResult
 *   │
 *   └─ 7. LEGACY PATH — Full AI Extraction (fallback when pipeline returns null)
 *           ├─ extractSpotData(richData) — GPT-5 holistic extraction (25 s timeout)
 *           ├─ geocodeSpotCompat()       — Geocode each extracted spot
 *           ├─ enhanceSpotData()         — Enrich with category/vibe/description
 *           └─ saveToCache() → return EngineResult
 * ```
 *
 * ## Two Execution Paths
 *
 * ### New Location Pipeline (primary)
 * Introduced to replace the legacy path for most posts. Runs the structured
 * 5-stage pipeline from `src/lib/location/`. Returns a single high-confidence
 * `ProcessedSpot` when successful.
 *
 * After the pipeline succeeds, `locationResultToSpot()` checks whether the
 * result already contains `category`, `vibe`, and `description` (which the
 * AI agent may have populated). If any are missing, it calls
 * `enhanceSpotData()` to fill them in.
 *
 * ### Legacy AI Extraction (fallback)
 * The original extraction strategy. Only reached when `extractLocation()`
 * returns `null` (all 5 pipeline stages failed). Passes the full `RichPostData`
 * context string directly to GPT-5 and asks it to identify travel spots
 * holistically. Can return multiple spots from a single post.
 *
 * ## Firestore Caching
 *
 * Results are stored in and retrieved from Firestore under the `"post_cache"`
 * collection, keyed by platform-specific post ID.
 *
 * - **TTL**: `CACHE_TTL_DAYS` days (default: 7). Entries older than this are
 *   treated as a cache miss and re-processed.
 * - **Cache hit**: Returns immediately with `cached: true` on the result.
 * - **Cache miss**: Runs the full pipeline, then writes the result before
 *   returning.
 *
 * Caching is best-effort — Firestore errors are caught and logged without
 * failing the request.
 *
 * ## Exported Types
 *
 * - `ProcessedSpot` — A single resolved travel location with coordinates,
 *   category, vibe, description, thumbnail, and confidence.
 * - `EngineResult`  — The full result returned to API consumers, containing
 *   `travel_spots[]`, `thumbnail`, `platform`, `post_id`, `rich_data`,
 *   and a `cached` boolean flag.
 *
 * ## Environment Variables
 *
 * - `RAPIDAPI_KEY`         — Required for Instagram + TikTok scrapers.
 * - `GITHUB_MODELS_TOKEN`  — Required for AI extraction and the AI agent.
 * - `PEXELS_API_KEY`       — Optional; used to fetch thumbnails when the
 *   scraper doesn't return one.
 *
 * @module engine
 */

import { db } from "@/lib/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import {
  scrapeInstagram,
  scrapeTikTok,
  type RichPostData,
} from "@/lib/scrapers";
import { extractSpotData } from "@/lib/ai";
import { type GeoResult } from "@/lib/geo";
import {
  extractLocation,
  buildSignals,
  type LocationResult,
} from "@/lib/location";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProcessedSpot {
  name: string;
  city: string;
  country: string;
  category: string;
  vibe: string;
  description: string;
  confidence: "high" | "medium" | "low";
  coordinates: [number, number];
  full_address: string;
  mapbox_id: string | null;
  thumbnail: string | null;
  original_link: string;
  geo_source: string;
}

export interface EngineResult {
  travel_spots: ProcessedSpot[];
  thumbnail: string | null;
  original_link: string;
  platform: "instagram" | "tiktok";
  post_id: string;
  cached: boolean;
  rich_data?: {
    location_name: string | null;
    hashtags: string[];
    top_comments: string[];
    user_bio: string;
    author_username: string;
  };
}

// ─── Platform Detection ───────────────────────────────────────────────────────

function detectPlatform(url: string): "instagram" | "tiktok" | null {
  if (url.includes("instagram.com")) return "instagram";
  if (url.includes("tiktok.com")) return "tiktok";
  return null;
}

function extractPostId(url: string, platform: "instagram" | "tiktok"): string {
  if (platform === "instagram") {
    return url.match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/)?.[1] || "";
  }
  if (platform === "tiktok") {
    // Both /video/<id> (videos) and /photo/<id> (image slideshows)
    return (
      url.match(/\/(?:video|photo)\/(\d+)/)?.[1] ||
      url.split(/\/(?:video|photo)\//)[1]?.split("?")[0] ||
      ""
    );
  }
  return "";
}

// ─── Firestore Cache ──────────────────────────────────────────────────────────

const CACHE_COLLECTION = "analysis_cache";
const CACHE_TTL_DAYS = 30;

async function checkCache(postId: string): Promise<EngineResult | null> {
  if (!postId) return null;
  try {
    const q = query(
      collection(db, CACHE_COLLECTION),
      where("post_id", "==", postId),
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      const doc = snap.docs[0].data();
      if (doc.created_at?.toDate) {
        const ageDays =
          (Date.now() - doc.created_at.toDate().getTime()) /
          (1000 * 60 * 60 * 24);
        if (ageDays > CACHE_TTL_DAYS) {
          console.log(`[Engine Cache] Stale entry for ${postId} — bypassing`);
          return null;
        }
      }
      console.log(`[Engine Cache] HIT ✅ for post_id: ${postId}`);
      return {
        travel_spots: doc.travel_spots || [],
        thumbnail: doc.thumbnail || null,
        original_link: doc.original_link || "",
        platform: doc.platform || "instagram",
        post_id: postId,
        cached: true,
        rich_data: doc.rich_data || undefined,
      };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Engine Cache] Lookup failed:", msg);
  }
  return null;
}

async function saveToCache(
  postId: string,
  result: Omit<EngineResult, "cached">,
): Promise<void> {
  if (!postId || result.travel_spots.length === 0) return;
  try {
    await addDoc(collection(db, CACHE_COLLECTION), {
      post_id: postId,
      platform: result.platform,
      travel_spots: result.travel_spots,
      thumbnail: result.thumbnail,
      original_link: result.original_link,
      rich_data: result.rich_data || null,
      created_at: serverTimestamp(),
    });
    console.log(`[Engine Cache] Saved result for post_id: ${postId}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Engine Cache] Save failed:", msg);
  }
}

// ─── Pexels Fallback Image ────────────────────────────────────────────────────

async function fetchPexelsImage(query: string): Promise<string | null> {
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (!pexelsKey || !query) return null;
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`,
      { headers: { Authorization: pexelsKey } },
    );
    const data = (await res.json()) as {
      photos?: Array<{ src?: { large?: string } }>;
    };
    return data.photos?.[0]?.src?.large || null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Engine] Pexels fallback failed:", msg);
    return null;
  }
}

// ─── Enrich spot metadata via AI ─────────────────────────────────────────────
// Called ONLY when we already have coordinates from the location pipeline.
// Gets category / vibe / description without re-doing location extraction.

async function enrichSpotMetadata(
  name: string,
  city: string,
  country: string,
): Promise<{ category: string; vibe: string; description: string }> {
  try {
    const { enhanceSpotData } = await import("@/lib/ai");
    const result = await enhanceSpotData(name, city, country);
    return {
      category: result?.category || "Attraction",
      vibe: result?.vibe || "scenic natural serene",
      description: result?.description || "",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[Engine] Metadata enrichment failed:", msg);
    return {
      category: "Attraction",
      vibe: "scenic natural serene",
      description: "",
    };
  }
}

// ─── Convert LocationResult → ProcessedSpot ──────────────────────────────────

async function locationResultToSpot(
  locationResult: LocationResult,
  richData: RichPostData,
  url: string,
): Promise<ProcessedSpot> {
  // Use description/category/vibe from pipeline if already present (AI agent
  // fills these in), otherwise enrich via AI metadata call.
  let category = locationResult.category ?? "";
  let vibe = locationResult.vibe ?? "";
  let description = locationResult.description ?? "";

  if (!category || !vibe || !description) {
    const meta = await enrichSpotMetadata(
      locationResult.name,
      locationResult.city,
      locationResult.country,
    );
    category = category || meta.category;
    vibe = vibe || meta.vibe;
    description = description || meta.description;
  }

  // Thumbnail: scraped first, Pexels fallback
  let thumbnail = richData.thumbnail;
  if (!thumbnail) {
    thumbnail = await fetchPexelsImage(
      `${locationResult.name} ${locationResult.city}`,
    );
  }

  const geoSourceChain = locationResult.source_chain.join("→");

  return {
    name: locationResult.name,
    city: locationResult.city || locationResult.name,
    country: locationResult.country || "Unknown",
    category,
    vibe,
    description,
    confidence: locationResult.confidence_label,
    coordinates: locationResult.coordinates,
    full_address: locationResult.full_address,
    mapbox_id: locationResult.mapbox_id,
    thumbnail,
    original_link: url,
    geo_source: geoSourceChain,
  };
}

// ─── Legacy AI path (geocodePlaceName import kept for type safety) ─────────

async function geocodeSingleSpot(
  name: string,
  city: string,
  country: string,
  locationLat: number | null,
  locationLng: number | null,
  rawSpotsCount: number,
): Promise<GeoResult> {
  // Inline import to avoid circular dependency issues at module load time
  const { geocodePlaceName } = await import("@/lib/geo");

  // Fast-path: if native GPS coords exist and single spot, use them
  if (rawSpotsCount === 1 && locationLat !== null && locationLng !== null) {
    console.log(`[Engine] Using native GPS for AI spot "${name}"`);
    return {
      coordinates: [locationLng, locationLat],
      full_address: name,
      mapbox_id: null,
      country: country || "Unknown",
      city,
      confidence: "exact",
      source: "native_gps",
    };
  }

  // Geocode AI's place name via Mapbox / cascade
  let geo = await geocodePlaceName(name, city || country || undefined);

  // If geocoder failed, retry with just city
  if (geo.confidence === "failed" && city) {
    console.warn(
      `[Engine] Geocoder failed for "${name}, ${city}" — retrying with city only`,
    );
    geo = await geocodePlaceName(city, country || undefined);
  }

  return geo;
}

// ─── Main Engine ──────────────────────────────────────────────────────────────

export async function processPost(url: string): Promise<EngineResult> {
  const platform = detectPlatform(url);
  if (!platform)
    throw new Error("Unsupported URL. Use an Instagram or TikTok link.");

  const postId = extractPostId(url, platform);
  console.log(
    `[Engine] Processing ${platform} post | id: ${postId || "unknown"}`,
  );

  // ── 1. Check Firestore cache ──────────────────────────────────────────────
  const cached = await checkCache(postId);
  if (cached) return cached;

  // ── 2. Scrape ─────────────────────────────────────────────────────────────
  console.log(`[Engine] Cache MISS — starting scrape pipeline…`);
  let richData: RichPostData;
  try {
    richData =
      platform === "instagram"
        ? await scrapeInstagram(url)
        : await scrapeTikTok(url);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Scraper failed: ${msg}`);
  }

  const creatorComments: string[] =
    ((richData as unknown as Record<string, unknown>)
      ._creatorComments as string[]) || [];
  const anchorLocations: string[] =
    ((richData as unknown as Record<string, unknown>)
      ._anchorLocations as string[]) || [];

  console.log(`[Engine] Scrape complete:`);
  console.log(`  caption         : ${richData.caption.length} chars`);
  console.log(`  hashtags        : ${richData.hashtags.length}`);
  console.log(`  comments        : ${richData.top_comments.length}`);
  console.log(`  creator_replies : ${creatorComments.length}`);
  console.log(`  anchor_locs     : ${anchorLocations.length}`);
  console.log(`  user_bio        : ${richData.user_bio.length} chars`);
  console.log(`  location_name   : ${richData.location_name || "none"}`);
  console.log(`  thumbnail       : ${richData.thumbnail ? "✅" : "❌"}`);

  // ── 3. NEW: Full location pipeline (Stages 1–5) ───────────────────────────
  // Build the signals object from scraped data and run the multi-stage pipeline.
  console.log(`[Engine] Running new location pipeline…`);
  const signals = buildSignals({
    caption: richData.caption,
    hashtags: richData.hashtags,
    top_comments: richData.top_comments,
    user_bio: richData.user_bio,
    location_name: richData.location_name,
    location_lat: richData.location_lat,
    location_lng: richData.location_lng,
    author_username: richData.author_username,
    thumbnail: richData.thumbnail,
    platform: richData.platform,
    _creatorComments: creatorComments,
    _anchorLocations: anchorLocations,
  });

  let locationResult: LocationResult | null = null;
  try {
    locationResult = await extractLocation(signals);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[Engine] Location pipeline error: ${msg}`);
  }

  if (locationResult) {
    console.log(
      `[Engine] ✅ Pipeline succeeded: "${locationResult.name}" → "${locationResult.full_address}"`,
    );
    console.log(
      `[Engine]    confidence: ${locationResult.confidence.toFixed(2)} (${locationResult.confidence_label})`,
    );
    console.log(
      `[Engine]    source_chain: [${locationResult.source_chain.join(" → ")}]`,
    );

    // Convert to ProcessedSpot (enriches category/vibe/description via AI if needed)
    const spot = await locationResultToSpot(locationResult, richData, url);

    const result: Omit<EngineResult, "cached"> = {
      travel_spots: [spot],
      thumbnail: richData.thumbnail,
      original_link: url,
      platform,
      post_id: postId,
      rich_data: {
        location_name: richData.location_name,
        hashtags: richData.hashtags,
        top_comments: richData.top_comments,
        user_bio: richData.user_bio,
        author_username: richData.author_username,
      },
    };

    await saveToCache(postId, result);
    return { ...result, cached: false };
  }

  // ── 4. LEGACY AI EXTRACTION (full fallback when pipeline returns null) ────
  // This path is only reached when all 5 pipeline stages failed to find a
  // location with sufficient confidence. It uses the original GPT-5 extractor.
  console.log(
    `[Engine] Pipeline returned null — falling back to legacy AI extraction…`,
  );

  // WEAK SIGNAL CHECK (Instagram only):
  // If we have very little data, don't waste 25s waiting for AI to timeout.
  if (platform === "instagram") {
    const hasLocation = !!richData.location_name;
    const hasComments = richData.top_comments.length > 0;
    const hasBio = richData.user_bio.length > 5;
    const hasHashtags = richData.hashtags.length > 0;
    const captionLen = richData.caption.length;

    // If no explicit location, no comments, and short caption/no bio, it's hopeless.
    const isWeak =
      !hasLocation &&
      !hasComments &&
      (!hasBio || richData.user_bio.length < 10) &&
      captionLen < 50 &&
      !hasHashtags;

    if (isWeak) {
      console.warn(
        `[Engine] Weak signals detected for Instagram post — skipping legacy AI to avoid timeout.`,
      );
      return {
        travel_spots: [],
        thumbnail: richData.thumbnail,
        original_link: url,
        platform,
        post_id: postId,
        rich_data: {
          location_name: richData.location_name,
          hashtags: richData.hashtags,
          top_comments: richData.top_comments,
          user_bio: richData.user_bio,
          author_username: richData.author_username,
        },
        cached: false,
      };
    }
  }

  let extraction: { travel_spots?: unknown[] } | null = null;
  try {
    extraction = (await extractSpotData(richData)) as {
      travel_spots?: unknown[];
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const isInstagram = platform === "instagram";
    const isTimeout = /timeout/i.test(msg) || /AI extraction failed/i.test(msg);

    // Instagram-only hardening:
    // If legacy AI fallback times out/fails on weak IG signals, return a safe
    // partial result instead of throwing a 500.
    if (isInstagram && isTimeout) {
      console.warn(
        `[Engine] Instagram legacy AI fallback timed out/failed — returning partial empty result. reason="${msg}"`,
      );
      return {
        travel_spots: [],
        thumbnail: richData.thumbnail,
        original_link: url,
        platform,
        post_id: postId,
        rich_data: {
          location_name: richData.location_name,
          hashtags: richData.hashtags,
          top_comments: richData.top_comments,
          user_bio: richData.user_bio,
          author_username: richData.author_username,
        },
        cached: false,
      };
    }

    throw new Error(`AI extraction failed: ${msg}`);
  }

  const raw_spots = Array.isArray(extraction?.travel_spots)
    ? extraction.travel_spots
    : [];

  console.log(`[Engine] AI found ${raw_spots.length} spot(s)`);

  if (raw_spots.length === 0) {
    return {
      travel_spots: [],
      thumbnail: richData.thumbnail,
      original_link: url,
      platform,
      post_id: postId,
      cached: false,
    };
  }

  // ── 5. Geocode AI spots (legacy path) ─────────────────────────────────────
  const travel_spots = await Promise.all(
    raw_spots.map(async (spotRaw: unknown): Promise<ProcessedSpot> => {
      const spot = spotRaw as Record<string, string>;
      const searchName = spot.name || "";
      const searchCity = spot.city || "";

      const geo = await geocodeSingleSpot(
        searchName,
        searchCity,
        spot.country || "",
        richData.location_lat,
        richData.location_lng,
        raw_spots.length,
      );

      let thumbnail = richData.thumbnail;
      if (!thumbnail) {
        thumbnail = await fetchPexelsImage(`${searchName} ${searchCity}`);
      }

      return {
        name: searchName || "Unknown",
        city: geo.city || searchCity || "Unknown",
        country: geo.country || spot.country || "Unknown",
        category: spot.category || "Attraction",
        vibe: spot.vibe || "",
        description: spot.description || "",
        confidence: (spot.confidence as "high" | "medium" | "low") || "medium",
        coordinates: geo.coordinates as [number, number],
        full_address: geo.full_address,
        mapbox_id: geo.mapbox_id,
        thumbnail,
        original_link: url,
        geo_source: `ai→${geo.source}`,
      };
    }),
  );

  // ── 6. Build and cache final result ──────────────────────────────────────
  const result: Omit<EngineResult, "cached"> = {
    travel_spots,
    thumbnail: richData.thumbnail,
    original_link: url,
    platform,
    post_id: postId,
    rich_data: {
      location_name: richData.location_name,
      hashtags: richData.hashtags,
      top_comments: richData.top_comments,
      user_bio: richData.user_bio,
      author_username: richData.author_username,
    },
  };

  await saveToCache(postId, result);
  return { ...result, cached: false };
}
