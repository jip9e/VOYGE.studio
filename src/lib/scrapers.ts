import axios from "axios";

export async function scrapeInstagram(url: string) {
  try {
    const rapidKey = process.env.RAPIDAPI_KEY;
    
    if (rapidKey) {
      console.log("Using Instagram120 API for Scrape...");
      const response = await axios.post("https://instagram120.p.rapidapi.com/api/instagram/links", 
        { url: url },
        {
          headers: {
            'x-rapidapi-key': rapidKey,
            'x-rapidapi-host': 'instagram120.p.rapidapi.com',
            'Content-Type': 'application/json'
          }
        }
      );
      
      const raw = response.data;
      console.log("RAW IG DATA:", JSON.stringify(raw));

      // PARSING BASED ON ACTUAL CURL RESPONSE
      // The API returns an array: [{ urls: [...], meta: { title: "caption" }, ... }]
      const item = Array.isArray(raw) ? raw[0] : raw;
      const caption = item?.meta?.title || item?.caption || "";
      const thumbnail = item?.pictureUrl || item?.thumbnail || null;

      return {
        caption: caption,
        thumbnail: thumbnail,
        short_code: item?.meta?.shortcode || url.split("/reel/")[1]?.split("/")[0] || ""
      };
    }

    throw new Error("RapidAPI Key missing.");
  } catch (error: any) {
    console.error("IG Scrape Error:", error.message);
    throw error;
  }
}

export async function scrapeTikTok(url: string) {
  try {
    const response = await axios.get(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    return {
      caption: response.data.title || "",
      location: null,
      thumbnail: response.data.thumbnail_url || null,
      video_id: url.split("/video/")[1]?.split("?")[0]
    };
  } catch (error: any) {
    console.error("TikTok Scrape Error:", error.message);
    throw error;
  }
}
