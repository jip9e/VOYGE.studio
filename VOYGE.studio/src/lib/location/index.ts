/**
 * @fileoverview Location Module — Public API
 *
 * Single entry-point for the entire 5-stage location extraction pipeline.
 * All consumers should import exclusively from `"@/lib/location"` rather
 * than reaching into individual stage modules directly.
 *
 * ## Pipeline Architecture
 *
 * The pipeline runs stages in the following order, short-circuiting as soon
 * as a result with sufficient confidence is found:
 *
 * ```
 * Stage 1 — Extractor   (extractor.ts)
 *   Zero-compute text analysis: pin emoji, native GPS tags, anchor locations,
 *   geo-hashtags, bio patterns, creator comments, comment vote triangulation.
 *   Returns a ranked list of CandidatePlace objects (no API calls).
 *
 * Stage 2 — Geocoder    (geocoder.ts)
 *   Multi-API geocoding cascade for each candidate:
 *   Mapbox SearchBox → Mapbox v5 → Nominatim → GeoNames → HERE → OpenCage → Overpass OSM
 *   Stops early when confidence ≥ 0.85.
 *
 * Stage 3 — Verifier    (verifier.ts)  [runs in parallel with Stage 2]
 *   Wikipedia + Google Knowledge Graph cross-check.
 *   Boosts confidence when authoritative wiki coordinates are found.
 *
 * Stage 4 — Vision      (vision.ts)    [runs in parallel with Stages 2+3]
 *   Google Vision API landmark detection on the post thumbnail.
 *   Acts as an independent signal that can override text-based results.
 *
 * Stage 5 — AI Agent    (ai-agent.ts)  [last resort, only when conf < 0.60]
 *   Tool-calling GPT-5 agent via GitHub Models / Azure AI Inference.
 *   Has access to: search_place, verify_place, search_natural_feature,
 *   reverse_geocode. Deadline: 45 s, MAX_ITERATIONS: 4.
 * ```
 *
 * ## Key Exports
 *
 * - `extractLocation(signals)`  — Run the full pipeline; returns `LocationResult | null`
 * - `buildSignals(richData)`    — Convert scraped `RichPostData` into `LocationSignals`
 * - `clearPipelineCache()`      — Flush the module-level result cache
 * - `LocationResult`            — The final resolved location type
 * - `LocationSignals`           — Input signals bag (caption, hashtags, GPS, …)
 *
 * @module location
 */

// ── Pipeline (main entry-point) ───────────────────────────────────────────────
export {
  extractLocation,
  buildSignals,
  clearPipelineCache,
  type LocationResult,
  type LocationSignals,
} from "./pipeline";

// ── Stage 1: Extractor ────────────────────────────────────────────────────────
export {
  extractCandidates,
  extractPlaceFromText,
  hashtagToPlace,
  KNOWN_GEO_HASHTAGS,
  type CandidatePlace,
} from "./extractor";

// ── Stage 2: Geocoder ─────────────────────────────────────────────────────────
export {
  geocodePlace,
  geocodeSpotCompat,
  geocodeFromNativeGps,
  type GeocoderResult,
} from "./geocoder";

// ── Stage 3: Verifier ─────────────────────────────────────────────────────────
export { verifyPlace, quickVerify, type VerificationResult } from "./verifier";

// ── Stage 4: Vision ───────────────────────────────────────────────────────────
export {
  detectLandmark,
  detectLandmarkWithFallback,
  type VisionResult,
} from "./vision";

// ── Stage 5: AI Agent ─────────────────────────────────────────────────────────
export { runAIAgent, type AIAgentResult } from "./ai-agent";
