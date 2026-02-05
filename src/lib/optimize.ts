import axios from "axios";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export async function optimizeRoute(coordinates: [number, number][]) {
  if (coordinates.length < 2) return null;

  // Mapbox Optimization API v1 (Standard for JS)
  // Optimization v2 is usually for fleet management, v1 is better for simple "Trip Planning"
  const coordsString = coordinates.map(c => c.join(',')).join(';');
  const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordsString}?access_token=${MAPBOX_TOKEN}&geometries=geojson&overview=full`;

  try {
    const response = await axios.get(url);
    if (response.data.code !== "Ok") {
      throw new Error(response.data.message || "Optimization failed");
    }

    return {
      geometry: response.data.trips[0].geometry,
      waypoints: response.data.waypoints.sort((a: any, b: any) => a.waypoint_index - b.waypoint_index)
    };
  } catch (error) {
    console.error("Route Optimization Error:", error);
    return null;
  }
}
