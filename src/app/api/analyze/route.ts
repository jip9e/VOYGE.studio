import { NextRequest, NextResponse } from "next/server";
import { scrapeInstagram, scrapeTikTok } from "@/lib/scrapers";
import { extractSpotData } from "@/lib/ai";
import { geocodeSpot } from "@/lib/geo";

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    let data;

    if (url.includes("instagram.com")) {
      data = await scrapeInstagram(url);
    } else if (url.includes("tiktok.com")) {
      data = await scrapeTikTok(url);
    } else {
      return NextResponse.json({ error: "Unsupported URL" }, { status: 400 });
    }

    const extraction = await extractSpotData(data.caption);
    const raw_spots = Array.isArray(extraction.travel_spots) 
      ? extraction.travel_spots 
      : [extraction];

    // Geocode each spot in parallel
    const travel_spots = await Promise.all(
      raw_spots.map(async (spot: any) => {
        const geo = await geocodeSpot(spot.name, spot.city);
        return {
          ...spot,
          ...geo
        };
      })
    );

    return NextResponse.json({
      travel_spots,
      thumbnail: data.thumbnail,
      original_link: url
    });
  } catch (error: any) {
    console.error("API Analyze Route Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
