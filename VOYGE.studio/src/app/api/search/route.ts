/**
 * @fileoverview GET /api/search — Mapbox Place Search (SearchBox Suggest)
 *
 * Proxies search queries to the Mapbox SearchBox Suggest API and returns a
 * normalised array of place suggestions. Used by the frontend search input to
 * power the autocomplete/typeahead experience when users manually add spots to
 * their map.
 *
 * ## Request
 *
 * ```http
 * GET /api/search?q=horseshoe+bend
 * ```
 *
 * ### Query Parameters
 * | Param | Type     | Required | Description                                  |
 * |-------|----------|----------|----------------------------------------------|
 * | `q`   | `string` | ✅       | Search query string (place name, address, …) |
 *
 * Returns an empty `{ suggestions: [] }` when `q` is absent rather than a
 * 400 error, so the frontend can safely call this on every keystroke.
 *
 * ## Response — Success (`200 OK`)
 *
 * ```json
 * {
 *   "suggestions": [
 *     {
 *       "name":         "Horseshoe Bend",
 *       "city":         "Page",
 *       "country":      "United States",
 *       "full_address": "Horseshoe Bend, Page, Arizona 86040, United States",
 *       "mapbox_id":    "poi.ABC123"
 *     }
 *   ]
 * }
 * ```
 *
 * Each suggestion is normalised from the raw Mapbox SearchBox response:
 * - `name`         — Primary display name of the place
 * - `city`         — Resolved from `context.place` or `context.address`
 * - `country`      — Resolved from `context.country`
 * - `full_address` — Pre-formatted full address string from Mapbox
 * - `mapbox_id`    — Mapbox feature ID; can be used to retrieve full details
 *
 * ## Response — Errors
 *
 * | Status | Condition                                       |
 * |--------|-------------------------------------------------|
 * | `500`  | Mapbox API request failed or returned an error  |
 *
 * ## Mapbox API Details
 *
 * Calls `https://api.mapbox.com/search/searchbox/v1/suggest` with:
 * - `types=poi,address,place` — limits results to relevant location types
 * - `session_token=voyge_session_123` — required by Mapbox SearchBox billing
 * - `access_token` — from `NEXT_PUBLIC_MAPBOX_TOKEN` environment variable
 *
 * ## Environment Variables
 *
 * - `NEXT_PUBLIC_MAPBOX_TOKEN` — Required. Mapbox public access token.
 *
 * @module api/search
 */
import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");

  if (!q) return NextResponse.json({ suggestions: [] });

  const url = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(q)}&access_token=${MAPBOX_TOKEN}&session_token=voyge_session_123&types=poi,address,place`;

  try {
    const response = await axios.get(url);
    const suggestions = response.data.suggestions.map((s: any) => ({
      name: s.name,
      city: s.context?.place?.name || s.context?.address?.name || "",
      country: s.context?.country?.name || "",
      full_address: s.full_address,
      mapbox_id: s.mapbox_id,
    }));

    return NextResponse.json({ suggestions });
  } catch (error: any) {
    console.error("Search API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
