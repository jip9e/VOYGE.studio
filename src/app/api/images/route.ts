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
      url: "https://images.pexels.com/photos/2166553/pexels-photo-2166553.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2" 
    });
  }

  try {
    const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`, {
      headers: {
        Authorization: apiKey,
      },
    });
    const data = await response.json();
    
    if (data.photos && data.photos.length > 0) {
      return NextResponse.json({ url: data.photos[0].src.large });
    }

    return NextResponse.json({ url: null });
  } catch (error) {
    console.error("Pexels fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch image" }, { status: 500 });
  }
}
