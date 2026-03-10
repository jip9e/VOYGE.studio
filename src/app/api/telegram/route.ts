/**
 * @fileoverview POST /api/telegram — Telegram Bot Webhook
 *
 * Handles incoming webhook updates from the Telegram Bot API. This endpoint
 * enables users to forward Instagram Reels and TikTok videos directly to
 * their VOYGE-linked Telegram chat, automatically extracting the location
 * and saving the spot to their personal map.
 *
 * ## Webhook Registration
 *
 * The webhook must be registered with Telegram once:
 * ```
 * https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-domain.com/api/telegram
 * ```
 *
 * ## Handled Message Types
 *
 * ### `/link <token>` Command
 * Links a Telegram user account to their VOYGE web account.
 *
 * Flow:
 * 1. User opens VOYGE web app → Settings → "Link Telegram" → gets a token.
 * 2. User sends `/link <token>` to the bot.
 * 3. Bot looks up the token in Firestore `users` collection, sets
 *    `telegram_id` on the matching user document, and clears the token.
 * 4. Future messages from this `telegram_id` are associated with that user.
 *
 * ### Social Media URL Forwarding
 * Any message containing an Instagram or TikTok URL triggers the analysis
 * pipeline.
 *
 * Flow:
 * 1. Bot validates that the sender's Telegram ID is linked to a VOYGE account.
 * 2. Extracts the URL from the message text (handles full URLs, bare domains,
 *    and raw Instagram shortcodes).
 * 3. Sends an acknowledgement message ("Analysing your link…").
 * 4. Calls `processPost(url)` — the full VOYGE engine pipeline.
 * 5. Saves each resolved `travel_spot` to Firestore `spots` collection under
 *    the linked user's ID.
 * 6. Replies with a formatted success message showing spot names, cities,
 *    categories, and confidence emojis (🎯 high · ✅ medium · 🔮 low).
 *
 * ### Unrecognised Messages
 * Non-URL, non-command messages are silently ignored (no reply sent).
 * This prevents the bot from responding to stickers, photos, voice messages, etc.
 *
 * ## URL Detection
 *
 * The `extractSocialUrl()` helper handles:
 * - Full `https://` Instagram and TikTok URLs
 * - Bare domain URLs (e.g. `instagram.com/reel/ABC`)
 * - Raw Instagram shortcodes (alphanumeric strings 6–59 chars with no spaces)
 * - TikTok short links (`vt.tiktok.com`, `vm.tiktok.com`)
 *
 * ## Error Handling
 *
 * All errors are caught at the top level and always return `{ ok: true }`
 * with HTTP 200 to Telegram. This is intentional — returning any non-200
 * response to Telegram causes it to retry the webhook aggressively, which
 * would create a retry storm. User-visible errors are communicated via chat
 * messages instead.
 *
 * ## Environment Variables
 *
 * - `TELEGRAM_BOT_TOKEN`   — Required. Bot token from @BotFather.
 * - `RAPIDAPI_KEY`         — Required by the scraper layer.
 * - `GITHUB_MODELS_TOKEN`  — Required by the AI extraction layer.
 *
 * @module api/telegram
 */
import { NextRequest, NextResponse } from "next/server";
import { processPost } from "@/lib/engine";
import { db } from "@/lib/firebase";
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
} from "firebase/firestore";

// Set TELEGRAM_BOT_TOKEN in your .env.local file.
// See .env.example for the required format.
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";

// ─── Main Webhook Handler ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!TELEGRAM_TOKEN) {
      console.warn("[Telegram] TELEGRAM_BOT_TOKEN not set — webhook disabled");
      return NextResponse.json({ ok: true });
    }
    if (!body.message) return NextResponse.json({ ok: true });

    const chatId: number = body.message.chat.id;
    const text: string = body.message.text || "";
    const tgUserId: string = body.message.from.id.toString();

    // ── 1. Handle /link command ─────────────────────────────────────────────
    if (text.startsWith("/link ")) {
      const token = text.split(" ")[1]?.trim();
      if (!token) {
        await sendTelegramMessage(chatId, "❌ Usage: /link YOUR_TOKEN");
        return NextResponse.json({ ok: true });
      }

      const q = query(
        collection(db, "users"),
        where("link_token", "==", token),
      );
      const snap = await getDocs(q);

      if (snap.empty) {
        await sendTelegramMessage(
          chatId,
          "❌ Invalid or expired token.\nGenerate a new one in the VOYGE web app → Settings.",
        );
      } else {
        const userDoc = snap.docs[0];
        await updateDoc(doc(db, "users", userDoc.id), {
          telegram_id: tgUserId,
          link_token: null,
        });
        await sendTelegramMessage(
          chatId,
          "✅ Account linked! Forward any Instagram Reel or TikTok link to this chat and it will instantly appear on your VOYGE map 🗺️",
        );
      }
      return NextResponse.json({ ok: true });
    }

    // ── 2. Auth check ───────────────────────────────────────────────────────
    const userQ = query(
      collection(db, "users"),
      where("telegram_id", "==", tgUserId),
    );
    const userSnap = await getDocs(userQ);

    if (userSnap.empty) {
      await sendTelegramMessage(
        chatId,
        "🔒 Your Telegram isn't linked yet.\n\nOpen VOYGE → Settings → Link Telegram, then send:\n/link YOUR_TOKEN",
      );
      return NextResponse.json({ ok: true });
    }

    const internalUserId: string = userSnap.docs[0].data().uid;

    // ── 3. Extract URL from message ─────────────────────────────────────────
    const url = extractSocialUrl(text);

    if (!url) {
      // Silently ignore non-link messages (could be commands, stickers, etc.)
      return NextResponse.json({ ok: true });
    }

    const platform = url.includes("instagram.com") ? "Instagram" : "TikTok";
    await sendTelegramMessage(
      chatId,
      `🔍 VOYGE Intelligence is analysing your ${platform} link...\n\nThis usually takes 5–15 seconds.`,
    );

    // ── 4. Run the VOYGE engine (scrape → AI → geocode → cache) ────────────
    let result;
    try {
      result = await processPost(url);
    } catch (e: any) {
      console.error("[Telegram] Engine error:", e);
      await sendTelegramMessage(
        chatId,
        `❌ Couldn't process that link.\n\n${e.message}\n\nMake sure the post is public and try again.`,
      );
      return NextResponse.json({ ok: true });
    }

    if (!result.travel_spots || result.travel_spots.length === 0) {
      await sendTelegramMessage(
        chatId,
        "🤔 VOYGE couldn't identify a specific travel location in that post. Try a post that clearly features a place!",
      );
      return NextResponse.json({ ok: true });
    }

    // ── 5. Save each spot to the user's Firestore collection ────────────────
    const saved: string[] = [];

    for (const spot of result.travel_spots) {
      try {
        await addDoc(collection(db, "spots"), {
          name: spot.name,
          city: spot.city,
          country: spot.country,
          category: spot.category,
          vibe: spot.vibe,
          description: spot.description,
          confidence: spot.confidence,
          coordinates: spot.coordinates,
          full_address: spot.full_address,
          mapbox_id: spot.mapbox_id || null,
          thumbnail: spot.thumbnail || null,
          original_link: url,
          user_id: internalUserId,
          source: platform.toLowerCase(),
          // Attach rich metadata for future reference
          meta: {
            location_name: result.rich_data?.location_name || null,
            hashtags: result.rich_data?.hashtags || [],
            author_username: result.rich_data?.author_username || "",
          },
          cached: result.cached,
          created_at: serverTimestamp(),
        });

        saved.push(`📍 ${spot.name} — ${spot.city}, ${spot.country}`);
      } catch (e: any) {
        console.error("[Telegram] Firestore save error:", e.message);
      }
    }

    // ── 6. Reply with success ───────────────────────────────────────────────
    const confidenceEmoji: Record<string, string> = {
      high: "🎯",
      medium: "✅",
      low: "🔮",
    };

    const spotsText = result.travel_spots
      .map(
        (s) =>
          `${confidenceEmoji[s.confidence] || "📍"} *${s.name}*\n   ${s.city}, ${s.country} · ${s.category}`,
      )
      .join("\n\n");

    const cachedNote = result.cached ? "\n\n⚡ _Loaded from cache_" : "";
    const locationNote = result.rich_data?.location_name
      ? `\n🏷️ Native tag: ${result.rich_data.location_name}`
      : "";

    await sendTelegramMessage(
      chatId,
      `✅ Synced to your VOYGE map!\n\n${spotsText}${locationNote}${cachedNote}`,
    );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[Telegram Webhook] Unhandled error:", error);
    // Always return 200 to Telegram to prevent retry storms
    return NextResponse.json({ ok: true });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractSocialUrl(text: string): string | null {
  // Try to find a full Instagram or TikTok URL
  const igMatch = text.match(
    /https?:\/\/(www\.)?instagram\.com\/(reel|p|tv)\/[^\s/?#]+/,
  );
  if (igMatch) return igMatch[0];

  const ttMatch = text.match(
    /https?:\/\/(www\.|vm\.|vt\.)?tiktok\.com\/[^\s]+/,
  );
  if (ttMatch) return ttMatch[0];

  // Handle bare domain (e.g. "instagram.com/reel/ABC123")
  const bareDomainMatch = text.match(
    /(instagram\.com\/(reel|p)\/[^\s/?#]+|tiktok\.com\/[^\s]+)/,
  );
  if (bareDomainMatch) return `https://${bareDomainMatch[0]}`;

  // Handle shortcodes pasted directly (e.g. "DTsNcsnjQe-")
  const cleanText = text.trim();
  if (
    cleanText.length > 5 &&
    cleanText.length < 60 &&
    !cleanText.includes(" ") &&
    !cleanText.startsWith("/") &&
    /^[A-Za-z0-9_\-]+$/.test(cleanText)
  ) {
    return `https://www.instagram.com/reel/${cleanText}/`;
  }

  return null;
}

async function sendTelegramMessage(
  chatId: number,
  text: string,
): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
      }),
    });
  } catch (e: any) {
    console.error("[Telegram] sendMessage failed:", e.message);
  }
}
