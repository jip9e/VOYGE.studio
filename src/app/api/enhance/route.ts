import { NextRequest, NextResponse } from "next/server";
import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

const token = process.env.GITHUB_MODELS_TOKEN || "";
const client = ModelClient(
  "https://models.inference.ai.azure.com",
  new AzureKeyCredential(token)
);

export async function POST(req: NextRequest) {
  try {
    const { name, city, country } = await req.json();

    const prompt = `
      Generate travel data for this specific location: "${name}, ${city}, ${country}".
      Return ONLY a JSON object with:
      - category: (Food, Stay, View, Activity, Shopping, Museum, Park, Attraction)
      - vibe: (3 words)
      - description: (A punchy, one-sentence description, under 80 characters)
    `;

    const response = await client.path("/chat/completions").post({
      body: {
        messages: [
          { role: "system", content: "You are a travel expert. Return JSON." },
          { role: "user", content: prompt }
        ],
        model: "gpt-4o",
        response_format: { type: "json_object" }
      }
    });

    if (response.status !== "200") {
      throw new Error(`AI Request Failed: ${response.status}`);
    }

    // @ts-ignore
    const aiData = JSON.parse(response.body.choices[0].message.content);

    // Fetch image from Pexels
    let thumbnail = null;
    const pexelsKey = process.env.PEXELS_API_KEY;
    if (pexelsKey) {
      try {
        const pexelsRes = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(name + " " + city)}&per_page=1`, {
          headers: { Authorization: pexelsKey }
        });
        const pexelsData = await pexelsRes.json();
        if (pexelsData.photos?.length > 0) {
          thumbnail = pexelsData.photos[0].src.large;
        }
      } catch (e) {
        console.error("Pexels fetch failed in enhance route", e);
      }
    }

    return NextResponse.json({
      ...aiData,
      thumbnail
    });
  } catch (error: any) {
    console.error("Enhance API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
