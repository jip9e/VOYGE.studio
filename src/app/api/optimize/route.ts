/**
 * @fileoverview POST /api/optimize — Route Optimization
 *
 * Accepts an ordered array of geographic coordinates and returns an
 * optimized visiting order along with the full route geometry, powered
 * by the Mapbox Optimization API v1.
 *
 * ## Request
 *
 * ```http
 * POST /api/optimize
 * Content-Type: application/json
 *
 * { "coordinates": [[-111.51, 36.879], [-112.11, 36.057], [-111.83, 37.003]] }
 * ```
 *
 * ### Body Parameters
 * | Field         | Type                  | Required | Description                              |
 * |---------------|-----------------------|----------|------------------------------------------|
 * | `coordinates` | `[number, number][]`  | ✅       | Array of `[longitude, latitude]` pairs. Minimum 2 points required. |
 *
 * Coordinates must be in `[longitude, latitude]` order (GeoJSON convention),
 * matching the format used by Mapbox and stored on each `ProcessedSpot`.
 *
 * ## Response — Success (`200 OK`)
 *
 * Returns the result from `optimizeRoute()`:
 * ```json
 * {
 *   "geometry": {
 *     "type": "LineString",
 *     "coordinates": [[-111.51, 36.879], [-111.83, 37.003], [-112.11, 36.057]]
 *   },
 *   "waypoints": [
 *     { "waypoint_index": 0, "name": "Horseshoe Bend", … },
 *     { "waypoint_index": 1, "name": "North Rim", … },
 *     { "waypoint_index": 2, "name": "Bryce Canyon", … }
 *   ]
 * }
 * ```
 *
 * - `geometry`   — A GeoJSON `LineString` of the optimized driving route,
 *   suitable for rendering directly on a Mapbox map.
 * - `waypoints`  — The input waypoints sorted by `waypoint_index` (optimized
 *   visit order). The frontend uses this to re-order the spots list.
 *
 * ## Response — Errors
 *
 * | Status | Condition                                                     |
 * |--------|---------------------------------------------------------------|
 * | `400`  | `coordinates` array is missing or contains fewer than 2 points |
 * | `500`  | Mapbox Optimization API returned a non-"Ok" code or failed    |
 * | `500`  | Unexpected server error                                       |
 *
 * ## Mapbox Optimization API
 *
 * Delegates to `optimizeRoute()` in `src/lib/optimize.ts`, which calls:
 * `GET https://api.mapbox.com/optimized-trips/v1/mapbox/driving/{coords}`
 *
 * Uses `geometries=geojson&overview=full` for full-resolution route geometry.
 * The Optimization API v1 is used (not v2, which targets fleet management).
 *
 * ## Environment Variables
 *
 * - `NEXT_PUBLIC_MAPBOX_TOKEN` — Required. Mapbox public access token.
 *
 * @module api/optimize
 */
import { NextRequest, NextResponse } from "next/server";
import { optimizeRoute } from "@/lib/optimize";

export async function POST(req: NextRequest) {
  try {
    const { coordinates } = await req.json();

    if (!coordinates || coordinates.length < 2) {
      return NextResponse.json(
        { error: "At least 2 points required" },
        { status: 400 },
      );
    }

    const result = await optimizeRoute(coordinates);

    if (!result) {
      return NextResponse.json(
        { error: "Optimization failed" },
        { status: 500 },
      );
    }

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
