/**
 * @file geo.ts — Legacy shim / compatibility layer
 *
 * @description
 * This file exists solely to preserve the old `@/lib/geo` import surface so
 * that all existing callers continue to compile and run without modification.
 *
 * @exports
 * - {@link GeoResult}            — result type returned by every geocode helper
 * - {@link ExtractedPlaceName}   — structured place-name extracted from signals
 * - {@link geocodePlaceName}     — geocode a plain text place name → GeoResult
 * - {@link geocodeSpot}          — lightweight spot geocoder used by page.tsx
 * - {@link extractExplicitPlaceName} — rule-based place extraction from post signals
 * - {@link directGeocode}        — fast-path geocoder used by the analysis engine
 *
 * @callers
 * - `src/app/page.tsx`           — imports `geocodeSpot` for manual spot search
 * - `src/lib/engine.ts`          — imports `directGeocode` and `geocodePlaceName`
 *
 * @deprecated
 * New code should import directly from `@/lib/location` sub-modules:
 * - `@/lib/location/geocoder`   for geocoding logic
 * - `@/lib/location/extractor`  for place-name extraction
 *
 * DO NOT add new logic here — extend the `location/*` modules instead.
 */

// ─── geo.ts — Legacy shim ─────────────────────────────────────────────────────
// This file keeps the old API surface intact so that existing code that imports
// from "@/lib/geo" continues to work unchanged.
//
// All heavy lifting is now delegated to the new location pipeline modules:
//   @/lib/location/geocoder  — multi-API geocoding cascade
//   @/lib/location/extractor — zero-compute text extraction
//
// DO NOT add new logic here — extend the location/* modules instead.

import { geocodePlace, geocodeSpotCompat } from "@/lib/location/geocoder";
import { extractPlaceFromText } from "@/lib/location/extractor";

// ─── Re-export types that engine.ts / other callers depend on ─────────────────

export interface GeoResult {
  coordinates: [number, number];
  full_address: string;
  mapbox_id: string | null;
  country: string;
  city: string;
  confidence: "exact" | "city" | "region" | "failed";
  source:
    | "native_gps"
    | "mapbox_poi"
    | "mapbox_place"
    | "mapbox_region"
    | "failed";
}

export interface ExtractedPlaceName {
  name: string;
  raw: string;
  source:
    | "creator_reply"
    | "caption"
    | "hashtag"
    | "bio"
    | "comment"
    | "location_tag";
  confidence: "high" | "medium" | "low";
}

// ─── Internal helpers (kept for directGeocode below) ─────────────────────────

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
]);

function extractPlaceFromBio(bio: string): string | null {
  if (!bio) return null;
  const patterns = [
    /\b([\w\s]{2,30})\s+based\b/i,
    /\bbased\s+(?:in|out\s+of)\s+([\w\s]{2,30})/i,
    /\bfrom\s+([\w\s]{2,30})(?:\s*[|•·,\n]|$)/i,
    /\bliving\s+in\s+([\w\s]{2,30})(?:\s*[|•·,\n]|$)/i,
    /\b(?:i\s+live\s+in|i['']m\s+(?:in|from))\s+([\w\s]{2,30})/i,
    /📍\s*([\w\s,]{3,40})/,
    /🌍\s*([\w\s,]{3,40})/,
    /🌎\s*([\w\s,]{3,40})/,
    /🌏\s*([\w\s,]{3,40})/,
  ];
  for (const p of patterns) {
    const m = bio.match(p);
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
        return place;
      }
    }
  }
  return null;
}

/** Map new geocoder source strings back to legacy GeoResult source values */
function mapSource(newSource: string): GeoResult["source"] {
  if (newSource === "native_gps") return "native_gps";
  if (newSource.includes("poi")) return "mapbox_poi";
  if (
    newSource.includes("mapbox_searchbox") ||
    newSource.includes("mapbox_v5") ||
    newSource.includes("nominatim") ||
    newSource.includes("here") ||
    newSource.includes("opencage") ||
    newSource.includes("geonames") ||
    newSource.includes("overpass")
  )
    return "mapbox_place";
  return "failed";
}

/** Map new geocoder confidence number back to legacy string */
function mapConfidence(conf: number): GeoResult["confidence"] {
  if (conf >= 0.9) return "exact";
  if (conf >= 0.7) return "city";
  if (conf >= 0.4) return "region";
  return "failed";
}

// ─── geocodePlaceName (legacy) ────────────────────────────────────────────────
// Preserved for any code that calls it directly.

export async function geocodePlaceName(
  placeName: string,
  contextHint?: string,
): Promise<GeoResult> {
  const result = await geocodePlace(placeName, {
    countryHint: contextHint,
  });

  if (!result) {
    return {
      coordinates: [0, 0],
      full_address: placeName,
      mapbox_id: null,
      country: "Unknown",
      city: placeName,
      confidence: "failed",
      source: "failed",
    };
  }

  return {
    coordinates: result.coordinates,
    full_address: result.full_address,
    mapbox_id: result.mapbox_id,
    country: result.country,
    city: result.city,
    confidence: mapConfidence(result.confidence),
    source: mapSource(result.source),
  };
}

// ─── geocodeSpot (legacy) ────────────────────────────────────────────────────
// Simple wrapper used by the engine for AI-extracted spots.

export async function geocodeSpot(
  name: string,
  city: string,
): Promise<{
  coordinates: [number, number] | number[];
  full_address: string;
  mapbox_id: string | null;
  country: string;
}> {
  return geocodeSpotCompat(name, city);
}

// ─── extractExplicitPlaceName (legacy) ───────────────────────────────────────
// Delegates to the new extractor's extractPlaceFromText.

export function extractExplicitPlaceName(signals: {
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
  creator_replies: string[];
  caption: string;
  hashtags: string[];
  user_bio: string;
  top_comments: string[];
  anchor_locations: string[];
}): ExtractedPlaceName | null {
  // Tier 1: Native GPS location tag
  if (signals.location_name) {
    return {
      name: signals.location_name,
      raw: signals.location_name,
      source: "location_tag",
      confidence: "high",
    };
  }

  // Tier 2: Anchor locations
  if (signals.anchor_locations.length > 0) {
    const anchor = signals.anchor_locations[0].trim();
    if (anchor.length > 2) {
      return {
        name: anchor,
        raw: anchor,
        source: "location_tag",
        confidence: "high",
      };
    }
  }

  // Tier 3: Creator replies
  for (const reply of signals.creator_replies) {
    const extracted = extractPlaceFromText(reply);
    if (extracted) {
      return {
        name: extracted,
        raw: reply,
        source: "creator_reply",
        confidence: "high",
      };
    }
  }

  // Tier 4: Caption
  if (signals.caption && signals.caption.trim().length > 3) {
    const extracted = extractPlaceFromText(signals.caption);
    if (extracted) {
      return {
        name: extracted,
        raw: signals.caption,
        source: "caption",
        confidence: "high",
      };
    }
  }

  // Tier 5: Hashtags
  for (const tag of signals.hashtags) {
    const { hashtagToPlace } = require("@/lib/location/extractor") as {
      hashtagToPlace: (tag: string) => string | null;
    };
    const place = hashtagToPlace(tag);
    if (place) {
      return {
        name: place,
        raw: `#${tag}`,
        source: "hashtag",
        confidence: "medium",
      };
    }
  }

  // Tier 6: Comments
  for (const comment of signals.top_comments) {
    const extracted = extractPlaceFromText(comment);
    if (extracted) {
      return {
        name: extracted,
        raw: comment,
        source: "comment",
        confidence: "medium",
      };
    }
  }

  // Tier 7: Bio
  if (signals.user_bio) {
    const bioPlace = extractPlaceFromBio(signals.user_bio);
    if (bioPlace) {
      return {
        name: bioPlace,
        raw: signals.user_bio,
        source: "bio",
        confidence: "low",
      };
    }
  }

  return null;
}

// ─── directGeocode (legacy) ───────────────────────────────────────────────────
// The engine calls this before falling back to full AI extraction.
// Now delegates to the new pipeline internally.

export async function directGeocode(signals: {
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
  creator_replies: string[];
  caption: string;
  hashtags: string[];
  user_bio: string;
  top_comments: string[];
  anchor_locations: string[];
}): Promise<{
  extracted: ExtractedPlaceName;
  geo: GeoResult;
} | null> {
  // Native GPS fast-path
  if (
    signals.location_name &&
    signals.location_lat !== null &&
    signals.location_lng !== null
  ) {
    console.log(
      `[Geo] 📍 Native GPS: "${signals.location_name}" (${signals.location_lat}, ${signals.location_lng})`,
    );
    return {
      extracted: {
        name: signals.location_name,
        raw: signals.location_name,
        source: "location_tag",
        confidence: "high",
      },
      geo: {
        coordinates: [signals.location_lng, signals.location_lat],
        full_address: signals.location_name,
        mapbox_id: null,
        country: "Unknown",
        city: signals.location_name,
        confidence: "exact",
        source: "native_gps",
      },
    };
  }

  const extracted = extractExplicitPlaceName(signals);
  if (!extracted) {
    console.log(
      `[Geo] No explicit place name found in scraped signals — AI needed`,
    );
    return null;
  }

  console.log(
    `[Geo] Explicit place found: "${extracted.name}" (source: ${extracted.source}, confidence: ${extracted.confidence})`,
  );

  const bioHint = extractPlaceFromBio(signals.user_bio) ?? undefined;
  const geo = await geocodePlaceName(extracted.name, bioHint);

  if (geo.confidence === "failed") {
    const retry = await geocodePlaceName(extracted.name);
    if (retry.confidence !== "failed") {
      return { extracted, geo: retry };
    }
    // Return even on failure so engine can decide
    return { extracted, geo };
  }

  return { extracted, geo };
}
