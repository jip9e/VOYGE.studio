/**
 * @fileoverview POST /api/analyze — Social Media Post Analyzer
 *
 * Accepts a single Instagram or TikTok URL, runs it through the full VOYGE
 * location extraction engine (`processPost()`), and returns a structured
 * `EngineResult` containing resolved travel spots with GPS coordinates,
 * categories, vibes, and confidence scores.
 *
 * ## Request
 *
 * ```http
 * POST /api/analyze
 * Content-Type: application/json
 *
 * { "url": "https://www.instagram.com/reel/ABC123/" }
 * ```
 *
 * ### Body Parameters
 * | Field | Type     | Required | Description                              |
 * |-------|----------|----------|------------------------------------------|
 * | `url` | `string` | ✅       | A public Instagram Reel/post or TikTok video URL |
 *
 * Only `instagram.com` and `tiktok.com` URLs are accepted. Any other domain
 * returns a 400 error.
 *
 * ## Response — Success (`200 OK`)
 *
 * Returns an `EngineResult` JSON object:
 * ```json
 * {
 *   "travel_spots": [
 *     {
 *       "name": "Horseshoe Bend",
 *       "city": "Page",
 *       "country": "United States",
 *       "coordinates": [-111.51, 36.879],
 *       "category": "View",
 *       "vibe": "dramatic canyon scenic",
 *       "description": "Iconic 270° meander of the Colorado River.",
 *       "confidence": "high",
 *       "full_address": "Horseshoe Bend, Page, Arizona, United States",
 *       "thumbnail": "https://…"
 *     }
 *   ],
 *   "thumbnail": "https://…",
 *   "platform": "instagram",
 *   "post_id": "ABC123",
 *   "cached": false,
 *   "rich_data": { "location_name": null, "hashtags": […], … }
 * }
 * ```
 *
 * ## Response — Errors
 *
 * | Status | Condition                                              |
 * |--------|--------------------------------------------------------|
 * | `400`  | Missing/invalid `url` field                            |
 * | `400`  | URL is not from Instagram or TikTok                    |
 * | `500`  | Scraper failure, pipeline error, or unexpected throw   |
 *
 * ## Engine Pipeline
 *
 * Internally delegates to `processPost(url)` which runs:
 * 1. Firestore cache check (returns immediately on HIT)
 * 2. Platform scraping (Instagram 4-layer / TikTok tikwm + scraper7)
 * 3. 5-stage location pipeline (extractor → geocoder → verifier → vision → AI agent)
 * 4. Legacy GPT-4o extraction (fallback if pipeline returns null)
 * 5. Firestore cache write
 *
 * @see {@link processPost} for full pipeline documentation
 * @module api/analyze
 */
import { NextRequest, NextResponse } from "next/server";
import { processPost } from "@/lib/engine";

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { error: "A valid URL is required." },
        { status: 400 },
      );
    }

    const trimmed = url.trim();

    if (!trimmed.includes("instagram.com") && !trimmed.includes("tiktok.com")) {
      return NextResponse.json(
        { error: "Unsupported URL. Please paste an Instagram or TikTok link." },
        { status: 400 },
      );
    }

    const result = await processPost(trimmed);

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[/api/analyze] Error:", error);
    return NextResponse.json(
      { error: error.message || "An unexpected error occurred." },
      { status: 500 },
    );
  }
}
