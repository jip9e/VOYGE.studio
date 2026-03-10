/**
 * @fileoverview GET /api/images — Pexels Travel Image Fetcher
 *
 * Fetches a single representative travel photograph from the
 * [Pexels](https://www.pexels.com/api/) stock photo library for a given
 * search query. Used by the frontend to display a hero/cover image for
 * newly added or manually searched travel spots.
 *
 * ## Request
 *
 * ```http
 * GET /api/images?query=Horseshoe+Bend+Arizona
 * ```
 *
 * ### Query Parameters
 * | Param   | Type     | Required | Description                                       |
 * |---------|----------|----------|---------------------------------------------------|
 * | `query` | `string` | ✅       | Search term (place name, city, landmark, etc.)    |
 *
 * ## Response — Success (`200 OK`)
 *
 * Returns a JSON object with a single `url` field:
 * ```json
 * { "url": "https://images.pexels.com/photos/1234567/pexels-photo-1234567.jpeg?…" }
 * ```
 *
 * The URL points to the `large` size variant of the first Pexels search
 * result, which is suitable for display as a card thumbnail or hero image.
 *
 * `url` is `null` when Pexels returns no results for the given query:
 * ```json
 * { "url": null }
 * ```
 *
 * ## Response — No API Key
 *
 * When `PEXELS_API_KEY` is not configured, the endpoint returns a hardcoded
 * fallback travel image URL rather than an error, so the UI always has
 * something to display:
 * ```json
 * { "url": "https://images.pexels.com/photos/2166553/pexels-photo-2166553.jpeg?…" }
 * ```
 *
 * ## Response — Errors
 *
 * | Status | Condition                                              |
 * |--------|--------------------------------------------------------|
 * | `400`  | `query` parameter is missing                           |
 * | `500`  | Pexels API request failed (network error, invalid key) |
 *
 * ## Pexels API Details
 *
 * Calls `GET https://api.pexels.com/v1/search` with:
 * - `query` — the URL-encoded search term
 * - `per_page=1` — only the single best result is needed
 *
 * Authentication is via the `Authorization` header using `PEXELS_API_KEY`.
 *
 * ## Environment Variables
 *
 * - `PEXELS_API_KEY` — Optional. Pexels REST API key. If absent, a static
 *   fallback image URL is returned instead of calling the API.
 *
 * @module api/images
 */
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query");

  if (!query) {
    return NextResponse.json({ error: "No query provided" }, { status: 400 });
  }

  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    // Fallback image if no API key is set
    return NextResponse.json({
      url: "https://images.pexels.com/photos/2166553/pexels-photo-2166553.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2",
    });
  }

  try {
    const response = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`,
      {
        headers: {
          Authorization: apiKey,
        },
      },
    );
    const data = await response.json();

    if (data.photos && data.photos.length > 0) {
      return NextResponse.json({ url: data.photos[0].src.large });
    }

    return NextResponse.json({ url: null });
  } catch (error) {
    console.error("Pexels fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch image" },
      { status: 500 },
    );
  }
}
