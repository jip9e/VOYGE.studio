import { NextRequest, NextResponse } from "next/server";
import { scrapeInstagram, scrapeTikTok } from "@/lib/scrapers";
import { extractSpotData } from "@/lib/ai";
import { geocodeSpot } from "@/lib/geo";
import { db } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp, query, where, getDocs, updateDoc, doc } from "firebase/firestore";

const TELEGRAM_TOKEN = "8286702405:AAHytSLdRIRZQuyI-5I3YnWGcD2536qkM6g";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.message) return NextResponse.json({ ok: true });

    const chatId = body.message.chat.id;
    const text = body.message.text || "";
    const tgUserId = body.message.from.id.toString();

    // 1. Handle Link Linking
    if (text.startsWith("/link ")) {
      const token = text.split(" ")[1];
      if (!token) return NextResponse.json({ ok: true });

      // Find user with this token
      const q = query(collection(db, "users"), where("link_token", "==", token));
      const snap = await getDocs(q);
      
      if (snap.empty) {
        await sendTelegramMessage(chatId, "❌ Invalid token. Generate a new one in the VOYGE web app.");
      } else {
        const userDoc = snap.docs[0];
        await updateDoc(doc(db, "users", userDoc.id), { 
          telegram_id: tgUserId,
          link_token: null // Clear token after use
        });
        await sendTelegramMessage(chatId, "✅ Account Linked! Your forwarded links will now appear in your VOYGE dashboard.");
      }
      return NextResponse.json({ ok: true });
    }

    // 2. Auth Check
    const userQ = query(collection(db, "users"), where("telegram_id", "==", tgUserId));
    const userSnap = await getDocs(userQ);
    if (userSnap.empty) {
      await sendTelegramMessage(chatId, "🔒 Account not linked. Send '/link YOUR_TOKEN' to connect your VOYGE account.");
      return NextResponse.json({ ok: true });
    }
    const internalUserId = userSnap.docs[0].data().uid;

    // 3. Process Link
    let url = "";
    if (text.includes("instagram.com")) url = text.match(/https?:\/\/(www\.)?instagram\.com\/(reel|p)\/[^\s\/\?]+/)?.[0] || "";
    if (text.includes("tiktok.com")) url = text.match(/https?:\/\/(www\.)?tiktok\.com\/[^\s]+/)?.[0] || "";

    if (!url) {
      const cleanedText = text.trim();
      // Handle shortened/partial paths from Share Sheet
      if (cleanedText.includes("instagram.com")) {
        // If it's a domain but missing https, fix it
        url = cleanedText.startsWith("http") ? cleanedText : "https://" + cleanedText;
      } else if (cleanedText.length > 5 && !cleanedText.includes(" ") && !cleanedText.includes("/")) {
        // Assume it's a shortcode like DTsNcsnjQe-
        url = `https://www.instagram.com/reel/${cleanedText}/`;
      } else {
        return NextResponse.json({ ok: true });
      }
    }

    // Extract shortcode reliably from various URL formats
    let shortcode = "";
    const reelMatch = url.match(/\/reel\/([^\/\?]+)/);
    const pMatch = url.match(/\/p\/([^\/\?]+)/);
    shortcode = reelMatch?.[1] || pMatch?.[1] || "";

    if (!shortcode && !url.includes("tiktok.com")) {
       await sendTelegramMessage(chatId, "❌ Could not find the Post ID in that link.");
       return NextResponse.json({ ok: true });
    }

    console.log("VOYGE Engine processing Shortcode:", shortcode);
    await sendTelegramMessage(chatId, `🔍 VOYGE Intelligence crunching link...\n\nPost ID: ${shortcode || 'TikTok'}`);

    let data;
    try {
      if (url.includes("instagram.com")) {
        // Force use of the RapidAPI engine with the extracted shortcode
        data = await scrapeInstagram(`https://www.instagram.com/p/${shortcode}/`);
      } else {
        data = await scrapeTikTok(url);
      }
    } catch (e: any) {
      console.error("Scraper Error:", e);
      await sendTelegramMessage(chatId, `❌ Scraper Error: ${e.message}\n\nMake sure the link is public.`);
      return NextResponse.json({ ok: true });
    }

    const extraction = await extractSpotData(data.caption);
    const raw_spots = Array.isArray(extraction.travel_spots) ? extraction.travel_spots : [extraction];

    const saved = [];
    for (const spot of raw_spots) {
      const geo = await geocodeSpot(spot.name, spot.city);
      await addDoc(collection(db, "spots"), {
        ...spot, ...geo,
        user_id: internalUserId,
        original_link: url,
        created_at: serverTimestamp()
      });
      saved.push(`${spot.name} (${geo.country || 'Unknown'})`);
    }

    await sendTelegramMessage(chatId, `✅ Synced to Map:\n\n${saved.map(n => "📍 " + n).join('\n')}`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: true });
  }
}

async function sendTelegramMessage(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}
