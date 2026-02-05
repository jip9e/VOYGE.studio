import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

const token = process.env.GITHUB_MODELS_TOKEN || "";
const client = ModelClient(
  "https://models.inference.ai.azure.com",
  new AzureKeyCredential(token)
);

export async function extractSpotData(caption: string) {
  if (!caption) return { travel_spots: [{ name: "Unknown", city: "Unknown", category: "Activity", vibe: "Unknown" }] };

  const prompt = `
    Extract travel spot info from this social media caption.
    Return ONLY a JSON object with a 'travel_spots' key containing an array of objects.
    Each object must have: name, city, category (Food, Stay, View, Activity, Shopping), vibe (3 words).
    
    Caption: "${caption.substring(0, 1000)}"
  `;

  try {
    const response = await client.path("/chat/completions").post({
      body: {
        messages: [
          { role: "system", content: "You are a travel data extractor. Return JSON." },
          { role: "user", content: prompt }
        ],
        model: "gpt-4o",
        response_format: { type: "json_object" }
      }
    });

    if (response.status !== "200") {
      // @ts-ignore
      console.error("AI API Error:", response.body);
      throw new Error(`AI Request Failed: ${response.status}`);
    }

    // @ts-ignore
    const content = JSON.parse(response.body.choices[0].message.content);
    return content;
  } catch (error) {
    console.error("AI Extraction Error:", error);
    throw error;
  }
}
