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
      mapbox_id: s.mapbox_id
    }));

    return NextResponse.json({ suggestions });
  } catch (error: any) {
    console.error("Search API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
