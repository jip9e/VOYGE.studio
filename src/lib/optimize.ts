/**
 * @fileoverview Mapbox Optimization API v1 Wrapper — `optimizeRoute()`
 *
 * Provides a thin wrapper around the
 * [Mapbox Optimization API v1](https://docs.mapbox.com/api/navigation/optimization/)
 * for computing the most efficient driving order when visiting multiple
 * waypoints ("Travelling Salesman Problem" for trip planning).
 *
 * ## When to Use
 *
 * Use this module when a user has added multiple travel spots to their map
 * and wants VOYGE to automatically sort them into the most efficient visiting
 * order. The Mapbox Optimization API v1 is designed specifically for this
 * "trip planning" use case (as opposed to v2, which targets multi-vehicle
 * fleet management).
 *
 * ## `optimizeRoute(coordinates)`
 *
 * ### Parameters
 * | Param         | Type                  | Description                               |
 * |---------------|-----------------------|-------------------------------------------|
 * | `coordinates` | `[number, number][]`  | Array of `[longitude, latitude]` pairs in any order. Minimum 2 required. |
 *
 * ### Returns
 * A Promise resolving to either:
 *
 * - **Success** — An object with:
 *   ```ts
 *   {
 *     geometry:  GeoJSON.LineString  // Full-resolution optimized driving route
 *     waypoints: MapboxWaypoint[]    // Input waypoints sorted by waypoint_index
 *   }
 *   ```
 *   The `geometry` field is a GeoJSON `LineString` suitable for direct use as
 *   a Mapbox GL source. The `waypoints` array is sorted by `waypoint_index`
 *   (ascending) so index 0 is the recommended first stop, index 1 the second,
 *   and so on.
 *
 * - **`null`** — Returned on any error (network failure, invalid coordinates,
 *   Mapbox API non-"Ok" response code, etc.). The caller should handle `null`
 *   gracefully and keep the original ordering.
 *
 * ### Mapbox API Details
 *
 * Calls:
 * ```
 * GET https://api.mapbox.com/optimized-trips/v1/mapbox/driving/{coords}
 *   ?access_token=…
 *   &geometries=geojson
 *   &overview=full
 * ```
 *
 * - `geometries=geojson` — Returns coordinates as a GeoJSON LineString
 *   instead of the default encoded polyline.
 * - `overview=full` — Returns the complete route geometry at full resolution
 *   (not simplified).
 *
 * ### Error Handling
 *
 * - If the Mapbox response code is anything other than `"Ok"`, the error
 *   message from the response is thrown and caught internally.
 * - All errors are logged to `console.error` and `null` is returned; errors
 *   are never propagated to the caller.
 * - Returns `null` immediately (without calling the API) when fewer than
 *   2 coordinates are provided.
 *
 * ## Environment Variables
 *
 * - `NEXT_PUBLIC_MAPBOX_TOKEN` — Required. Mapbox public access token with
 *   the Optimization API scope enabled.
 *
 * @module optimize
 */
import axios from "axios";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

/**
 * Computes the most efficient visiting order for a set of waypoints using
 * the Mapbox Optimization API v1 (driving profile).
 *
 * @param coordinates - An array of `[longitude, latitude]` pairs to optimise.
 *   Must contain at least 2 entries; returns `null` immediately for fewer.
 * @returns The optimised route geometry and sorted waypoints, or `null` on
 *   any error.
 */
export async function optimizeRoute(coordinates: [number, number][]) {
  if (coordinates.length < 2) return null;

  // Mapbox Optimization API v1 (Standard for JS)
  // Optimization v2 is usually for fleet management, v1 is better for simple "Trip Planning"
  const coordsString = coordinates.map((c) => c.join(",")).join(";");
  const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordsString}?access_token=${MAPBOX_TOKEN}&geometries=geojson&overview=full`;

  try {
    const response = await axios.get(url);
    if (response.data.code !== "Ok") {
      throw new Error(response.data.message || "Optimization failed");
    }

    return {
      geometry: response.data.trips[0].geometry,
      waypoints: response.data.waypoints.sort(
        (a: any, b: any) => a.waypoint_index - b.waypoint_index,
      ),
    };
  } catch (error) {
    console.error("Route Optimization Error:", error);
    return null;
  }
}
