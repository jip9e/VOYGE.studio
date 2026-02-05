import axios from "axios";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export async function geocodeSpot(name: string, city: string) {
  const query = `${name}, ${city}`;
  const url = `https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(query)}&access_token=${MAPBOX_TOKEN}&types=poi,address,address,place&limit=1`;

  try {
    const response = await axios.get(url);
    const feature = response.data.features?.[0];

    if (!feature) {
      // Fallback to general city search if POI not found
      const fallbackUrl = `https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(city)}&access_token=${MAPBOX_TOKEN}&types=place&limit=1`;
      const fallbackResponse = await axios.get(fallbackUrl);
      const fallbackFeature = fallbackResponse.data.features?.[0];
      
      return {
        coordinates: fallbackFeature?.geometry?.coordinates || [0, 0],
        full_address: fallbackFeature?.properties?.full_address || city,
        mapbox_id: fallbackFeature?.properties?.mapbox_id || null,
        country: fallbackFeature?.properties?.context?.country?.name || "Unknown"
      };
    }

    return {
      coordinates: feature.geometry.coordinates,
      full_address: feature.properties.full_address || feature.properties.name,
      mapbox_id: feature.properties.mapbox_id,
      country: feature.properties?.context?.country?.name || "Unknown"
    };
  } catch (error) {
    console.error("Geocoding Error:", error);
    return { coordinates: [0, 0], full_address: city, mapbox_id: null };
  }
}
