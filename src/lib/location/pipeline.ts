/**
 * @fileoverview Location Extraction Pipeline — Orchestration Layer (Stage 6)
 *
 * This module is the central orchestrator for the 5-stage location extraction
 * pipeline. It coordinates all stages, manages parallel execution, applies
 * confidence scoring, and maintains a module-level result cache.
 *
 * ## Pipeline Stages
 *
 * | Stage | Module        | Description                                              |
 * |-------|---------------|----------------------------------------------------------|
 * | 1     | extractor.ts  | Zero-compute text extraction (no API calls)              |
 * | 2     | geocoder.ts   | Multi-API geocoding cascade                              |
 * | 3     | verifier.ts   | Wikipedia + Google Knowledge Graph verification          |
 * | 4     | vision.ts     | Google Vision API landmark detection on thumbnail        |
 * | 5     | ai-agent.ts   | Tool-calling GPT-5 agent (last resort)                   |
 *
 * ### Stage 1 — Extractor
 * Parses all available text signals (caption, hashtags, bio, comments, creator
 * replies, anchor locations) without making any API calls. Returns a list of
 * `CandidatePlace` objects sorted by confidence descending.
 *
 * ### Stage 2 — Geocoder
 * For each candidate above `GEOCODE_CONFIDENCE_FLOOR`, runs the multi-API
 * geocoding cascade: Mapbox SearchBox → Mapbox v5 → Nominatim → GeoNames →
 * HERE → OpenCage → Overpass OSM. Stops as soon as confidence ≥ 0.85.
 *
 * ### Stage 3 — Verifier
 * Runs in parallel with Stage 2. Calls Wikipedia and Google Knowledge Graph
 * to confirm the place is real and retrieve authoritative GPS coordinates.
 * A Wikipedia coordinates hit applies a ×1.15 confidence multiplier.
 *
 * ### Stage 4 — Vision
 * Starts in parallel with Stages 2+3. Sends the post thumbnail to Google
 * Vision API for landmark detection. Can independently identify iconic places
 * (e.g. Eiffel Tower, Machu Picchu) and contribute its own geocoded result.
 *
 * ### Stage 5 — AI Agent
 * Invoked only when the best result from Stages 1–4 has confidence below
 * `AI_AGENT_THRESHOLD` (0.6). Runs a tool-calling GPT-5 loop via GitHub
 * Models (Azure AI Inference) with a 45-second deadline and up to
 * `MAX_ITERATIONS` (4) tool-call rounds.
 *
 * ## Confidence Scoring
 *
 * Final confidence is computed as:
 * ```
 * final = base_confidence × geocoder_multiplier × verification_multiplier
 * ```
 *
 * **Geocoder multipliers** (higher = more trusted provider):
 * - `native_gps`       → 1.00
 * - `mapbox_searchbox` → 0.97
 * - `mapbox_v5`        → 0.95
 * - `nominatim`        → 0.90
 * - `geonames`         → 0.88
 * - `here` / `opencage`→ 0.88
 * - `overpass_osm`     → 0.85
 * - (unknown)          → 0.80
 *
 * **Verification multipliers**:
 * - Wiki coords found  → 1.15
 * - KG confirmed       → 1.10
 * - Verified only      → 1.05
 * - Not verified       → 0.90
 *
 * **Confidence labels**:
 * - `high`   → ≥ 0.80
 * - `medium` → ≥ 0.55
 * - `low`    → < 0.55
 *
 * ## Caching
 *
 * Results are cached in a module-level `Map` keyed by a djb2 hash of the
 * most stable signal fields (native tag, lat/lng, username, platform, top
 * hashtags, caption prefix). The cache lives for the lifetime of the Next.js
 * server process and can be explicitly flushed via `clearPipelineCache()`.
 *
 * ## Key Constants
 *
 * - `GEOCODE_CONFIDENCE_FLOOR` = **0.55** — minimum candidate confidence
 *   required to proceed to geocoding (Stage 2). Prevents wasting API quota
 *   on weak guesses.
 * - `AI_AGENT_THRESHOLD` = **0.60** — if the best result after Stages 1–4
 *   is below this, the AI agent (Stage 5) is invoked.
 * - `RETURN_THRESHOLD` = **0.65** — results below this threshold are still
 *   returned but labelled `"low"` confidence.
 *
 * ## Main Exports
 *
 * - `extractLocation(signals)` — Run the full pipeline end-to-end.
 * - `buildSignals(richData)`   — Convert a `RichPostData`-shaped object into
 *   the `LocationSignals` input bag expected by the pipeline.
 * - `clearPipelineCache()`     — Flush the module-level result cache.
 * - `LocationResult`           — The resolved location output type.
 * - `LocationSignals`          — Re-export from extractor.ts for convenience.
 *
 * @module location/pipeline
 */

// ─── Stage 6: Pipeline Orchestrator ──────────────────────────────────────────
// Runs all location extraction stages in the optimal order with confidence
// scoring, parallel execution where possible, and module-level caching.

import {
  extractCandidates,
  type CandidatePlace,
  type LocationSignals,
} from "./extractor";
import { geocodePlace, type GeocoderResult } from "./geocoder";
import { verifyPlace, type VerificationResult } from "./verifier";
import { detectLandmarkWithFallback, type VisionResult } from "./vision";
import { runAIAgent, type AIAgentResult } from "./ai-agent";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LocationResult {
  name: string;
  city: string;
  country: string;
  coordinates: [number, number]; // [lng, lat]
  full_address: string;
  mapbox_id: string | null;
  confidence: number; // 0.0 – 1.0
  confidence_label: "high" | "medium" | "low";
  source_chain: string[]; // e.g. ["creator_reply", "wikipedia_verify", "mapbox_geocode"]
  category?: string;
  vibe?: string;
  description?: string;
}

// Re-export LocationSignals so callers only need to import from pipeline or index
export type { LocationSignals };

// ─── Module-level result cache ────────────────────────────────────────────────
// Keyed by a hash of the signals to avoid re-running the pipeline for the same
// post. Cleared on process restart (module is long-lived in Next.js server).

const resultCache = new Map<string, LocationResult | null>();

function buildCacheKey(signals: LocationSignals): string {
  // Use the most stable identifiers — native tag + top hashtags + caption prefix
  const parts = [
    signals.location_name ?? "",
    signals.location_lat?.toFixed(4) ?? "",
    signals.location_lng?.toFixed(4) ?? "",
    signals.author_username,
    signals.platform,
    (signals.hashtags ?? []).slice(0, 8).join(","),
    (signals.caption ?? "").substring(0, 80),
  ];
  // Simple djb2 hash — good enough for a cache key
  let hash = 5381;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      hash = ((hash << 5) + hash) ^ part.charCodeAt(i);
      hash = hash >>> 0; // keep 32-bit unsigned
    }
  }
  return hash.toString(36);
}

// ─── Confidence helpers ────────────────────────────────────────────────────────

/**
 * Final confidence formula:
 *   base_confidence × geocoder_multiplier × verification_multiplier
 *
 * Geocoder multipliers:
 *   native_gps        → 1.0
 *   mapbox_searchbox  → 0.97
 *   mapbox_v5         → 0.95
 *   nominatim         → 0.90
 *   geonames          → 0.88
 *   here / opencage   → 0.88
 *   overpass_osm      → 0.85
 *   (none / failed)   → 0.80
 *
 * Verification multipliers:
 *   wiki coords found → 1.15
 *   kg confirmed only → 1.10
 *   verified (no geo) → 1.05
 *   not verified      → 0.90
 */
function geocoderMultiplier(source: string): number {
  const MAP: Record<string, number> = {
    native_gps: 1.0,
    mapbox_searchbox: 0.97,
    mapbox_v5: 0.95,
    nominatim: 0.9,
    geonames: 0.88,
    here: 0.88,
    opencage: 0.88,
    overpass_osm: 0.85,
  };
  return MAP[source] ?? 0.8;
}

function verificationMultiplier(v: VerificationResult | null): number {
  if (!v) return 0.9;
  if (v.wikiCoords) return 1.15;
  if (v.kgTypes && v.kgTypes.length > 0 && v.verified) return 1.1;
  if (v.verified) return 1.05;
  return 0.9;
}

function computeFinalConfidence(
  baseConfidence: number,
  geoSource: string,
  verification: VerificationResult | null,
): number {
  const raw =
    baseConfidence *
    geocoderMultiplier(geoSource) *
    verificationMultiplier(verification);
  return Math.min(1.0, Math.max(0.0, raw));
}

function confidenceLabel(c: number): "high" | "medium" | "low" {
  if (c >= 0.8) return "high";
  if (c >= 0.55) return "medium";
  return "low";
}

// ─── Well-known confidence floors (override computed value when source is certain) ─

const SOURCE_CONFIDENCE_FLOORS: Record<string, number> = {
  native_gps: 1.0,
  anchor_location: 0.97,
  pin_emoji: 0.95,
  creator_reply: 0.9,
  caption_explicit: 0.85,
  geo_hashtag: 0.8,
  tagged_account: 0.7,
  bio_based: 0.6,
  comment_answer: 0.65,
  music_title: 0.5,
};

// ─── Build LocationResult from geocoder + verifier + candidate ────────────────

function assembleResult(
  candidate: CandidatePlace,
  geo: GeocoderResult,
  verification: VerificationResult | null,
  sourceChain: string[],
  overrides?: Partial<LocationResult>,
): LocationResult {
  // Use Wikipedia coordinates if available and more precise than geocoder
  const coordinates: [number, number] =
    verification?.wikiCoords ?? geo.coordinates;

  // Compute confidence
  const floor = SOURCE_CONFIDENCE_FLOORS[candidate.source] ?? 0.5;
  const computed = computeFinalConfidence(
    Math.max(candidate.confidence, floor),
    geo.source,
    verification,
  );
  const confidence = Math.min(1.0, computed);

  // Build description from verification data if available
  const description =
    overrides?.description ??
    verification?.kgDescription?.substring(0, 90) ??
    verification?.wikiExtract?.substring(0, 90) ??
    undefined;

  return {
    name: candidate.name,
    city: geo.city || candidate.name,
    country: geo.country || "Unknown",
    coordinates,
    full_address: geo.full_address,
    mapbox_id: geo.mapbox_id,
    confidence,
    confidence_label: confidenceLabel(confidence),
    source_chain: sourceChain,
    description,
    ...overrides,
  };
}

// ─── Detect if a place name is a natural feature ──────────────────────────────

function isNaturalFeature(name: string): boolean {
  return /\b(river|creek|stream|lake|pond|falls|waterfall|canyon|gorge|valley|mountain|mount|peak|summit|volcano|beach|bay|cove|glacier|fjord|sound|inlet|forest|woods|jungle|dunes|plateau|desert|reef|lagoon|spring|geyser|cave|arch|butte|mesa|bluff|cliff|ridge)\b/i.test(
    name,
  );
}

// ─── Stage 2+3: Geocode + verify a single candidate ──────────────────────────

interface ScoredCandidate {
  candidate: CandidatePlace;
  geo: GeocoderResult;
  verification: VerificationResult | null;
  result: LocationResult;
}

async function processCandidate(
  candidate: CandidatePlace,
  signals: LocationSignals,
): Promise<ScoredCandidate | null> {
  const sourceChain: string[] = [candidate.source];

  try {
    // ── Geocode ────────────────────────────────────────────────────────────
    const countryHint =
      candidate.countryHint ??
      (signals.user_bio ? extractCountryFromBio(signals.user_bio) : undefined);

    const geo = await geocodePlace(candidate.name, {
      lat:
        candidate.source === "native_gps"
          ? (signals.location_lat ?? undefined)
          : undefined,
      lng:
        candidate.source === "native_gps"
          ? (signals.location_lng ?? undefined)
          : undefined,
      countryHint,
      isNaturalFeature: isNaturalFeature(candidate.name),
    });

    if (!geo) {
      console.log(
        `[Pipeline] No geocoder result for "${candidate.name}" — skipping`,
      );
      return null;
    }
    sourceChain.push(geo.source);

    // ── Verify in parallel with geocoding (already done above sequentially)
    let verification: VerificationResult | null = null;
    try {
      verification = await verifyPlace(candidate.name);
      if (verification.verified) {
        sourceChain.push(
          verification.wikiCoords ? "wikipedia_coords" : "wikipedia_verify",
        );
        if (verification.kgTypes && verification.kgTypes.length > 0) {
          sourceChain.push("knowledge_graph");
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[Pipeline] Verification failed for "${candidate.name}": ${msg}`,
      );
    }

    const result = assembleResult(candidate, geo, verification, sourceChain);

    console.log(
      `[Pipeline] Candidate "${candidate.name}": confidence=${result.confidence.toFixed(2)} (${result.confidence_label}) source=${candidate.source} geo=${geo.source} verified=${verification?.verified ?? false}`,
    );

    return { candidate, geo, verification, result };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[Pipeline] processCandidate failed for "${candidate.name}": ${msg}`,
    );
    return null;
  }
}

// ─── Bio country hint extractor ───────────────────────────────────────────────

function extractCountryFromBio(bio: string): string | undefined {
  if (!bio) return undefined;
  const m =
    bio.match(
      /\b(oregon|washington|california|colorado|utah|texas|florida|hawaii|alaska|montana|wyoming|idaho|nevada|arizona|new\s+mexico|new\s+york|georgia|tennessee|virginia|carolina|maine|vermont)\b/i,
    ) ??
    bio.match(
      /\b(iceland|norway|sweden|finland|denmark|france|germany|spain|italy|portugal|greece|turkey|japan|thailand|indonesia|bali|vietnam|cambodia|india|nepal|australia|new\s+zealand|canada|mexico|brazil|argentina|chile|peru|colombia|morocco|egypt|kenya|tanzania|south\s+africa|dubai|uae|ireland|scotland|switzerland|austria|croatia|slovenia)\b/i,
    );
  return m?.[0] ?? undefined;
}

// ─── Vision result → LocationResult ──────────────────────────────────────────

async function visionToResult(
  vision: VisionResult,
): Promise<LocationResult | null> {
  try {
    const sourceChain: string[] = ["google_vision"];

    // Try to geocode the landmark name for full address details
    const geo = await geocodePlace(vision.landmark, {
      lat: vision.coordinates[1],
      lng: vision.coordinates[0],
    });

    const geoResult: GeocoderResult = geo ?? {
      coordinates: vision.coordinates,
      full_address: vision.landmark,
      country: "Unknown",
      city: vision.landmark,
      mapbox_id: null,
      confidence: vision.confidence,
      source: "google_vision",
    };

    if (geo) sourceChain.push(geo.source);

    // Quick Wikipedia verify for the landmark name
    let verification: VerificationResult | null = null;
    try {
      verification = await verifyPlace(vision.landmark);
      if (verification.verified) sourceChain.push("wikipedia_verify");
    } catch {
      // non-fatal
    }

    const confidence = Math.min(
      1.0,
      vision.confidence *
        geocoderMultiplier(geoResult.source) *
        verificationMultiplier(verification),
    );

    return {
      name: vision.landmark,
      city: geoResult.city,
      country: geoResult.country,
      coordinates: vision.coordinates,
      full_address: geoResult.full_address,
      mapbox_id: geoResult.mapbox_id,
      confidence,
      confidence_label: confidenceLabel(confidence),
      source_chain: sourceChain,
      description:
        verification?.wikiExtract?.substring(0, 90) ??
        verification?.kgDescription?.substring(0, 90) ??
        undefined,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[Pipeline] visionToResult failed for "${vision.landmark}": ${msg}`,
    );
    return null;
  }
}

// ─── AI agent result → LocationResult ────────────────────────────────────────

function aiAgentToResult(agent: AIAgentResult): LocationResult {
  const confidence = Math.min(1.0, agent.confidence);
  return {
    name: agent.name,
    city: agent.city,
    country: agent.country,
    coordinates: agent.coordinates,
    full_address: agent.full_address,
    mapbox_id: agent.mapbox_id,
    confidence,
    confidence_label: confidenceLabel(confidence),
    source_chain: agent.source_chain,
    category: agent.category,
    vibe: agent.vibe,
    description: agent.description,
  };
}

// ─── Main pipeline ────────────────────────────────────────────────────────────

const AI_AGENT_THRESHOLD = 0.6;
const RETURN_THRESHOLD = 0.65;
const GEOCODE_CONFIDENCE_FLOOR = 0.55; // min candidate confidence to geocode

/**
 * Full location extraction pipeline.
 *
 * Stages:
 *  1. Zero-compute text extraction (extractor.ts)
 *  2. Multi-API geocoding cascade (geocoder.ts)   ─┐ run in parallel
 *  3. Wikipedia + KG verification (verifier.ts)   ─┘ per candidate
 *  4. Google Vision landmark detection (vision.ts) ─ parallel with 2+3
 *  5. AI agent with tool-calling (ai-agent.ts)    ─ only if conf < 0.60
 *
 * @param signals - Scraped post signals
 * @returns Best LocationResult or null if location cannot be determined
 */
export async function extractLocation(
  signals: LocationSignals,
): Promise<LocationResult | null> {
  const cacheKey = buildCacheKey(signals);
  if (resultCache.has(cacheKey)) {
    const cached = resultCache.get(cacheKey) ?? null;
    console.log(
      `[Pipeline] Cache HIT for key ${cacheKey}: ${cached ? `"${cached.name}"` : "null"}`,
    );
    return cached;
  }

  console.log(
    `[Pipeline] ─── Starting location pipeline ───────────────────────────────`,
  );
  console.log(
    `[Pipeline] Platform: ${signals.platform} | @${signals.author_username}`,
  );
  console.log(
    `[Pipeline] native_tag=${signals.location_name ?? "none"} | ` +
      `anchors=${(signals._anchorLocations ?? []).length} | ` +
      `creator_replies=${(signals._creatorComments ?? []).length} | ` +
      `hashtags=${signals.hashtags.length}`,
  );

  const pipelineStart = Date.now();

  // ── Stage 1: Zero-compute extraction ──────────────────────────────────────
  const candidates: CandidatePlace[] = extractCandidates(signals);

  console.log(
    `[Pipeline] Stage 1 complete: ${candidates.length} candidates in ${Date.now() - pipelineStart}ms`,
  );

  // ── Stage 4: Vision (start in parallel with geocoding) ────────────────────
  const visionPromise: Promise<LocationResult | null> = (async () => {
    if (!signals.thumbnail) return null;
    try {
      const vision = await detectLandmarkWithFallback(
        signals.thumbnail,
        "/api/proxy?url=",
      );
      if (!vision) return null;
      return visionToResult(vision);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[Pipeline] Vision stage error: ${msg}`);
      return null;
    }
  })();

  // ── Stage 2+3: Geocode + verify candidates with confidence ≥ floor ────────
  const eligibleCandidates = candidates.filter(
    (c) => c.confidence >= GEOCODE_CONFIDENCE_FLOOR,
  );

  // Always include top 1 candidate even if below floor (prevents total miss)
  if (eligibleCandidates.length === 0 && candidates.length > 0) {
    eligibleCandidates.push(candidates[0]);
  }

  console.log(
    `[Pipeline] Stage 2+3: geocoding + verifying ${eligibleCandidates.length} candidate(s) in parallel…`,
  );

  // Run geocode+verify for all eligible candidates in parallel
  const geocodeStart = Date.now();
  const scoredResults = await Promise.all(
    eligibleCandidates.map((c) => processCandidate(c, signals)),
  );
  console.log(
    `[Pipeline] Stage 2+3 complete in ${Date.now() - geocodeStart}ms`,
  );

  // Filter out nulls and sort by confidence descending
  const validResults: ScoredCandidate[] = scoredResults
    .filter((r): r is ScoredCandidate => r !== null)
    .sort((a, b) => b.result.confidence - a.result.confidence);

  // ── Await Vision result ───────────────────────────────────────────────────
  let visionResult: LocationResult | null = null;
  try {
    visionResult = await visionPromise;
    if (visionResult) {
      console.log(
        `[Pipeline] Stage 4 (Vision): "${visionResult.name}" conf=${visionResult.confidence.toFixed(2)}`,
      );
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[Pipeline] Vision result failed: ${msg}`);
  }

  // ── Pick best result so far ────────────────────────────────────────────────
  let best: LocationResult | null = validResults[0]?.result ?? null;

  // Compare against Vision result
  if (visionResult && (!best || visionResult.confidence > best.confidence)) {
    console.log(
      `[Pipeline] Vision result is best so far: "${visionResult.name}" (${visionResult.confidence.toFixed(2)}) > ${best ? `"${best.name}" (${best.confidence.toFixed(2)})` : "none"}`,
    );
    best = visionResult;
  }

  console.log(
    `[Pipeline] Best result before AI gate: ${best ? `"${best.name}" conf=${best.confidence.toFixed(2)}` : "none"}`,
  );

  // ── Stage 5: AI agent (last resort) ──────────────────────────────────────
  if (!best || best.confidence < AI_AGENT_THRESHOLD) {
    console.log(
      `[Pipeline] Confidence ${best?.confidence.toFixed(2) ?? "N/A"} < threshold ${AI_AGENT_THRESHOLD} — invoking AI agent…`,
    );

    const aiStart = Date.now();
    let aiResult: AIAgentResult | null = null;

    try {
      aiResult = await runAIAgent(signals);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[Pipeline] AI agent error: ${msg}`);
    }

    console.log(
      `[Pipeline] Stage 5 (AI agent) complete in ${Date.now() - aiStart}ms`,
    );

    if (aiResult) {
      const aiLocation = aiAgentToResult(aiResult);

      // If AI agent also ran Wikipedia verify (via tool calls), boost confidence
      const wikiVerified = aiResult.source_chain.some((s) =>
        s.includes("verify_place"),
      );

      if (wikiVerified) {
        aiLocation.confidence = Math.min(1.0, aiLocation.confidence * 1.15);
        aiLocation.confidence_label = confidenceLabel(aiLocation.confidence);
        aiLocation.source_chain.push("ai_wiki_verified");
      }

      console.log(
        `[Pipeline] AI agent result: "${aiLocation.name}" conf=${aiLocation.confidence.toFixed(2)}`,
      );

      // Use AI result if it's better than what we had
      if (!best || aiLocation.confidence > best.confidence) {
        best = aiLocation;
      }
    }
  }

  // ── Final confidence gate ─────────────────────────────────────────────────
  if (!best) {
    console.log(`[Pipeline] ❌ No location found after all stages`);
    resultCache.set(cacheKey, null);
    return null;
  }

  if (best.confidence < RETURN_THRESHOLD) {
    console.log(
      `[Pipeline] ⚠️  Best confidence ${best.confidence.toFixed(2)} below return threshold ${RETURN_THRESHOLD} — returning anyway with low label`,
    );
    // Still return it but label is already "low" at this confidence level
  }

  console.log(
    `[Pipeline] ✅ Final result: "${best.name}, ${best.city}, ${best.country}" ` +
      `conf=${best.confidence.toFixed(2)} (${best.confidence_label}) ` +
      `chain=[${best.source_chain.join(" → ")}] ` +
      `total_time=${Date.now() - pipelineStart}ms`,
  );

  resultCache.set(cacheKey, best);
  return best;
}

/**
 * Build a LocationSignals object from a RichPostData-shaped object.
 * This bridges the old engine API to the new pipeline.
 */
export function buildSignals(richData: {
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
}): LocationSignals {
  return {
    caption: richData.caption ?? "",
    hashtags: richData.hashtags ?? [],
    top_comments: richData.top_comments ?? [],
    user_bio: richData.user_bio ?? "",
    location_name: richData.location_name,
    location_lat: richData.location_lat,
    location_lng: richData.location_lng,
    author_username: richData.author_username ?? "",
    thumbnail: richData.thumbnail,
    platform: richData.platform,
    _creatorComments: richData._creatorComments,
    _anchorLocations: richData._anchorLocations,
  };
}

/**
 * Clear the in-memory result cache.
 * Useful in tests or when you want to force re-extraction.
 */
export function clearPipelineCache(): void {
  resultCache.clear();
  console.log("[Pipeline] Cache cleared");
}
