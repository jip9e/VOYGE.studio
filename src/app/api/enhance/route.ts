/**
 * @fileoverview POST /api/enhance — Travel Spot Enrichment
 *
 * Accepts a known place name + city (and optional country), calls
 * `enhanceSpotData()` to generate structured travel metadata via GPT-4o,
 * then fetches a representative photo from the Pexels API.
 *
 * ## Request
 *
 * ```http
 * POST /api/enhance
 * Content-Type: application/json
 *
 * { "name": "Horseshoe Bend", "city": "Page", "country": "United States" }
 * ```
 *
 * ### Body Parameters
 * | Field     | Type     | Required | Description                          |
 * |-----------|----------|----------|--------------------------------------|
 * | `name`    | `string` | ✅       | Place name (e.g. "Eiffel Tower")     |
 * | `city`    | `string` | ✅       | City or region the place is in       |
 * | `country` | `string` | ❌       | Country name (improves AI accuracy)  |
 *
 * ## Response — Success (`200 OK`)
 *
 * Returns an enrichment object merging AI metadata with a Pexels thumbnail:
 * ```json
 * {
 *   "category":    "View",
 *   "vibe":        "dramatic canyon scenic",
 *   "description": "Iconic 270° meander of the Colorado River near Page, AZ.",
 *   "thumbnail":   "https://images.pexels.com/photos/…/…jpeg"
 * }
 * ```
 *
 * `thumbnail` is `null` when `PEXELS_API_KEY` is not configured or when
 * Pexels returns no results for the `"<name> <city>"` query.
 *
 * ## Response — Errors
 *
 * | Status | Condition                              |
 * |--------|----------------------------------------|
 * | `400`  | `name` or `city` is missing            |
 * | `500`  | AI enhancement or unexpected error     |
 *
 * ## Internals
 *
 * 1. Calls `enhanceSpotData(name, city, country)` — a GPT-4o request with a
 *    12-second timeout. Returns safe defaults on failure.
 * 2. If `PEXELS_API_KEY` is set, searches Pexels for `"<name> <city>"` and
 *    returns the `large` variant of the first result as `thumbnail`.
 *
 * ## Environment Variables
 *
 * - `PEXELS_API_KEY`       — Optional. Pexels REST API key for photo lookup.
 * - `GITHUB_MODELS_TOKEN`  — Required by `enhanceSpotData()` for GPT-4o.
 *
 * @module api/enhance
 */
import { NextRequest, NextResponse } from "next/server";
import { enhanceSpotData } from "@/lib/ai";

export async function POST(req: NextRequest) {
  try {
    const { name, city, country } = await req.json();

    if (!name || !city) {
      return NextResponse.json(
        { error: "name and city are required" },
        { status: 400 },
      );
    }

    const aiData = await enhanceSpotData(name, city, country || "");

    // Fetch image from Pexels
    let thumbnail: string | null = null;
    const pexelsKey = process.env.PEXELS_API_KEY;
    if (pexelsKey) {
      try {
        const pexelsRes = await fetch(
          `https://api.pexels.com/v1/search?query=${encodeURIComponent(
            `${name} ${city}`,
          )}&per_page=1`,
          { headers: { Authorization: pexelsKey } },
        );
        const pexelsData = await pexelsRes.json();
        if (pexelsData.photos?.length > 0) {
          thumbnail = pexelsData.photos[0].src.large;
        }
      } catch (e) {
        console.error("Pexels fetch failed in enhance route", e);
      }
    }

    return NextResponse.json({ ...aiData, thumbnail });
  } catch (error: any) {
    console.error("Enhance API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
