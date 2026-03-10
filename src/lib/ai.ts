/**
 * @fileoverview Legacy AI Extraction — `extractSpotData()` & `enhanceSpotData()`
 *
 * This module provides two GPT-4o-powered functions that handle the AI layer
 * of the VOYGE location pipeline. Both functions call the
 * [GitHub Models](https://github.com/marketplace/models) endpoint via the
 * Azure AI Inference REST SDK, authenticated with `GITHUB_MODELS_TOKEN`.
 *
 * ## `extractSpotData(data)`
 *
 * **Purpose**: Holistically analyse all available signals from a social media
 * post and extract one or more specific, real-world travel locations.
 *
 * **When it runs**: This is the *legacy* extraction path — it is only invoked
 * by `engine.ts` when the full 5-stage location pipeline (`src/lib/location/`)
 * returns `null` (i.e. all structured stages failed). It is also used directly
 * by the Telegram bot as a quick fallback.
 *
 * **Input**: Accepts either a `RichPostData` object (full scraper output with
 * caption, hashtags, comments, bio, creator replies, anchor locations, and
 * composite hints) or a plain `string` (legacy caption-only mode for
 * backward compatibility).
 *
 * **Prompt strategy**: The model receives a prioritised signal list:
 * 1. 🏷️  Native location tag (100% trust)
 * 2. 📌  Video anchor locations (TikTok POI metadata)
 * 3. 🎯  Creator's own comments (highest human authority)
 * 4. 📍  Pre-extracted text signals (from extractor.ts)
 * 5. 🧩  Composite hints (region + environment type)
 * 6. 💬  Location-relevant viewer comments
 * 7. 📝  Caption text
 * 8. 🔖  Hashtags
 * 9. 🧑  Creator bio / @username
 *
 * **Timeout**: Races the API call against a **25-second** deadline via
 * `Promise.race()`. On timeout or any error, returns a safe default result:
 * ```ts
 * { travel_spots: [{ name: "Unknown", city: "Unknown", confidence: "low", … }] }
 * ```
 *
 * **Output**: A `{ travel_spots: SpotData[] }` object where each `SpotData`
 * contains `name`, `city`, `category`, `vibe`, `description`, and
 * `confidence` (`"high" | "medium" | "low"`).
 *
 * ## `enhanceSpotData(name, city, country)`
 *
 * **Purpose**: Enrich a *known* travel spot (already geocoded) with structured
 * metadata: category, vibe keywords, and a punchy one-sentence description.
 *
 * **When it runs**:
 * - By `engine.ts → locationResultToSpot()` when the location pipeline
 *   returns a result but the AI agent did not populate `category`/`vibe`.
 * - By `/api/enhance` route when the frontend requests manual enrichment of
 *   a saved spot.
 *
 * **Timeout**: Races against a **12-second** deadline. On timeout or error,
 * returns safe defaults:
 * ```ts
 * { category: "Attraction", vibe: "scenic natural serene", description: "…" }
 * ```
 *
 * **Output**: `{ category: string; vibe: string; description: string }`
 *
 * ## Environment Variables
 *
 * - `GITHUB_MODELS_TOKEN` — Required. Personal access token for GitHub Models
 *   (Azure AI Inference). Without it, all calls will fail with a 401.
 *
 * @module ai
 */

import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import {
  extractLocationSignals,
  filterUsefulComments,
  buildCompositeHints,
  type LocationSignal,
  type CompositeLocationHint,
} from "@/lib/scrapers";

const token = process.env.GITHUB_MODELS_TOKEN || "";
const client = ModelClient(
  "https://models.inference.ai.azure.com",
  new AzureKeyCredential(token),
);

// ─── Rich Data Interface ──────────────────────────────────────────────────────
export interface RichPostData {
  caption: string;
  hashtags: string[];
  top_comments: string[];
  user_bio: string;
  location_name: string | null;
  location_lat: number | null;
  location_lng: number | null;
  thumbnail: string | null;
  author_username: string;
  platform: "instagram" | "tiktok";
  post_id: string;
  // Optional enrichment fields populated by TikTok scraper
  _creatorComments?: string[];
  _compositeHints?: CompositeLocationHint[];
  _anchorLocations?: string[];
}

// ─── Context Builder ──────────────────────────────────────────────────────────
function buildContextString(data: RichPostData): string {
  const parts: string[] = [];

  parts.push(
    `Platform: ${data.platform === "instagram" ? "Instagram" : "TikTok"}`,
  );

  if (data.author_username) {
    parts.push(`Creator Username: @${data.author_username}`);
  }

  // ── 1. Native location tag / anchor location (highest confidence) ─────────
  if (data.location_name) {
    parts.push(
      `\n🏷️  NATIVE LOCATION TAG (HIGHEST CONFIDENCE — use this as the primary location):\n   "${data.location_name}"`,
    );
    if (data.location_lat && data.location_lng) {
      parts.push(`   GPS: ${data.location_lat}, ${data.location_lng}`);
    }
  }

  // ── 2. Anchor locations from video metadata ───────────────────────────────
  if (data._anchorLocations && data._anchorLocations.length > 0) {
    parts.push(
      `\n📌 VIDEO ANCHOR LOCATIONS (embedded in video metadata — very reliable):`,
    );
    data._anchorLocations.forEach((loc, i) => {
      parts.push(`   ${i + 1}. "${loc}"`);
    });
  }

  // ── 3. Creator's own comments (they KNOW where they filmed) ──────────────
  if (data._creatorComments && data._creatorComments.length > 0) {
    parts.push(
      `\n🎯 CREATOR'S OWN COMMENTS (posted by @${data.author_username} — HIGHEST TRUST for location):`,
    );
    data._creatorComments.forEach((c, i) => {
      parts.push(`   ${i + 1}. "${c.substring(0, 200)}"`);
    });
    parts.push(
      `   ↳ The creator filmed this content — treat their comments as ground truth for location.`,
    );
  }

  // ── 4. Pre-extracted location signals (structured, ranked by confidence) ──
  const signals: LocationSignal[] = extractLocationSignals(
    data.top_comments,
    data.caption,
    data.user_bio,
    data.hashtags,
    data.author_username,
    data._creatorComments,
  );

  if (signals.length > 0) {
    parts.push(
      `\n📍 PRE-EXTRACTED LOCATION SIGNALS (auto-parsed from all text, ranked by confidence):`,
    );
    signals
      .filter((s) => s.source !== "context_clue")
      .slice(0, 8)
      .forEach((s, i) => {
        const emoji =
          s.confidence === "high"
            ? "🟢"
            : s.confidence === "medium"
              ? "🟡"
              : "🔴";
        parts.push(
          `   ${i + 1}. ${emoji} "${s.text}" — source: ${s.source} | confidence: ${s.confidence}`,
        );
        // Show the raw text it came from (for non-trivial sources)
        if (s.source !== "hashtag" && s.source !== "bio" && s.raw !== s.text) {
          parts.push(`      from: "${s.raw.substring(0, 130)}"`);
        }
      });
    parts.push(
      `   ↳ Cross-reference ALL signals. Multiple signals pointing to the same region = higher confidence.`,
    );
  }

  // ── 5. Composite hints (geo region + nature context) ─────────────────────
  // e.g. "Oregon" (bio) + "river" (comment) → "river in Oregon"
  const compositeHints: CompositeLocationHint[] =
    data._compositeHints && data._compositeHints.length > 0
      ? data._compositeHints
      : buildCompositeHints(signals);

  if (compositeHints.length > 0) {
    parts.push(
      `\n🧩 COMPOSITE LOCATION HINTS (region + environment type combined):`,
    );
    compositeHints.slice(0, 4).forEach((h, i) => {
      parts.push(
        `   ${i + 1}. "${h.combined}" — use this to identify the specific ${h.context} in ${h.region}`,
      );
    });
    parts.push(
      `   ↳ Use these hints to narrow down to a SPECIFIC named location (e.g. "river in Oregon" → "McKenzie River, Oregon").`,
    );
  }

  // ── 6. Caption ────────────────────────────────────────────────────────────
  if (data.caption) {
    parts.push(`\n📝 Caption:\n"${data.caption.substring(0, 1200)}"`);
  }

  // ── 7. Hashtags ───────────────────────────────────────────────────────────
  if (data.hashtags.length > 0) {
    parts.push(
      `\n🔖 Hashtags: ${data.hashtags
        .slice(0, 40)
        .map((h) => `#${h}`)
        .join(" ")}`,
    );
  }

  // ── 8. Creator bio ────────────────────────────────────────────────────────
  if (data.user_bio) {
    parts.push(`\n🧑 Creator Bio:\n"${data.user_bio.substring(0, 400)}"`);
  }

  // ── 9. Comments — split into creator / answers / questions / neutral ──────
  if (data.top_comments.length > 0) {
    const creatorSet = new Set(data._creatorComments || []);
    const nonCreatorComments = data.top_comments.filter(
      (c) => !creatorSet.has(c),
    );

    const { answers, questions } = filterUsefulComments(nonCreatorComments);
    const neutral = nonCreatorComments.filter(
      (c) => !answers.includes(c) && !questions.includes(c),
    );

    if (answers.length > 0) {
      parts.push(
        `\n💬 LOCATION-RELEVANT COMMENTS (contain place names or describe the location):`,
      );
      answers.forEach((c, i) => {
        parts.push(`   ${i + 1}. "${c.substring(0, 200)}"`);
      });
    }

    if (questions.length > 0) {
      parts.push(
        `\n❓ LOCATION QUESTIONS from viewers (these are QUESTIONS, NOT answers — do NOT use as location evidence):`,
      );
      questions.slice(0, 4).forEach((c, i) => {
        parts.push(`   ${i + 1}. "${c.substring(0, 120)}"`);
      });
    }

    // Only show neutral if nothing more useful exists
    if (
      neutral.length > 0 &&
      answers.length === 0 &&
      !data._creatorComments?.length
    ) {
      parts.push(`\n💬 Other viewer comments:`);
      neutral.slice(0, 5).forEach((c, i) => {
        parts.push(`   ${i + 1}. "${c.substring(0, 160)}"`);
      });
    }
  }

  // ── 10. Signal quality summary ────────────────────────────────────────────
  const highCount = signals.filter(
    (s) => s.confidence === "high" && s.source !== "context_clue",
  ).length;
  const medCount = signals.filter(
    (s) => s.confidence === "medium" && s.source !== "context_clue",
  ).length;
  const hasNativeTag = !!data.location_name;
  const hasCreatorComment = !!data._creatorComments?.length;
  const hasComposite = compositeHints.length > 0;
  const contextClues = signals
    .filter((s) => s.source === "context_clue")
    .map((s) => s.text)
    .join(", ");

  parts.push(
    `\n⚡ Signal summary: native_tag=${hasNativeTag ? "YES" : "no"} | creator_comment=${hasCreatorComment ? "YES" : "no"} | composite_hints=${hasComposite ? "YES" : "no"} | high_conf=${highCount} | medium_conf=${medCount} | caption_len=${data.caption.length} | hashtags=${data.hashtags.length} | comments=${data.top_comments.length}${contextClues ? ` | env_context="${contextClues}"` : ""}`,
  );

  return parts.join("\n");
}

// ─── Main Extractor ───────────────────────────────────────────────────────────
export async function extractSpotData(data: RichPostData | string) {
  // Backward-compatible: accept plain string (caption only)
  const isLegacy = typeof data === "string";
  const context = isLegacy
    ? `Platform: Unknown\n\n📝 Caption:\n"${(data as string).substring(0, 1000)}"`
    : buildContextString(data as RichPostData);

  if (!context.trim()) {
    return {
      travel_spots: [
        {
          name: "Unknown",
          city: "Unknown",
          category: "Activity",
          vibe: "Unknown",
          description: "No data available",
          confidence: "low",
        },
      ],
    };
  }

  const prompt = `You are an elite travel spot extractor powering VOYGE — a travel discovery app that pins exact real-world locations from social media posts.

Your job: analyze ALL the provided signals holistically and extract SPECIFIC, real-world travel locations.

━━━ SIGNAL PRIORITY ORDER (most → least reliable) ━━━
1. 🏷️  NATIVE LOCATION TAG        →  100% trust. Use directly. Set confidence "high".
2. 📌  VIDEO ANCHOR LOCATIONS     →  Embedded in TikTok metadata. Very reliable. Confidence "high".
3. 🎯  CREATOR'S OWN COMMENTS     →  The creator filmed this — they KNOW the location. Confidence "high".
4. 📍  PRE-EXTRACTED SIGNALS      →  Already parsed from all text. Start here for your best leads.
5. 🧩  COMPOSITE HINTS            →  Region + environment type. Use to infer the SPECIFIC named spot.
6. 💬  LOCATION-RELEVANT COMMENTS →  Viewer comments naming a place. Good supporting evidence.
7. 📝  Caption text               →  Look for place names, landmarks, restaurants, neighbourhoods.
8. 🔖  Hashtags                   →  Geo-tags like #oregon #iceland #bali are strong signals.
9. 🧑  Creator Bio / @username    →  "oregon based" = the creator lives/works in Oregon.
10. ❓  LOCATION QUESTIONS         →  "where is this?" — viewers ASKING. Contains ZERO location info. IGNORE.

━━━ CRITICAL RULES FOR COMMENTS ━━━
- "LOCATION QUESTIONS" are viewers asking where the place IS. They are NOT answers. NEVER use them as location evidence.
- "LOCATION-RELEVANT COMMENTS" DO contain evidence — prioritise them.
- Creator's own comments are ground truth — the person who filmed it is telling you where it is.
- A viewer asking "where is this? olympic natl park?" does NOT mean it IS olympic national park — it's a guess from someone who doesn't know.

━━━ COMPOSITE HINT USAGE ━━━
If you see a composite hint like "river in Oregon":
- This means signals indicate the content shows a RIVER and the creator is OREGON-BASED.
- Use your knowledge to identify the most likely specific named river/location in Oregon matching the visual context.
- Examples: "river in Oregon" → consider McKenzie River, Rogue River, Sandy River, Deschutes River, etc.
- Set confidence "medium" for composite inferences. Never invent a location — pick the most geographically plausible one.

━━━ TIKTOK SPARSE DATA RULES ━━━
TikTok captions are often under 20 chars and may have no hashtags. In these cases:
- The PRE-EXTRACTED SIGNALS and COMPOSITE HINTS sections are your most reliable guides.
- A creator bio saying "oregon based" + a video showing a river = strong inference about Oregon rivers.
- "oregon based" in bio means the creator is IN Oregon — the video is likely filmed in Oregon.
- If only a state/country is identifiable (not a specific venue), pick the most iconic/recognisable attraction for that environment type (e.g. "river in Oregon" → McKenzie River).
- Never return empty travel_spots — always make your best inference with appropriate confidence level.

━━━ OUTPUT FORMAT ━━━
Return ONLY a valid JSON object with a "travel_spots" array.
Each object MUST have exactly these keys:
  - name        → Specific spot name (e.g. "McKenzie River", "Blue Lagoon", "Café de Flore"). If only a region is known, use its most iconic landmark matching the environment context.
  - city        → City or region (e.g. "McKenzie Bridge", "Reykjavik", "Paris")
  - country     → Full country name (e.g. "United States", "Iceland", "France")
  - category    → Exactly one of: Food | Stay | View | Activity | Shopping | Museum | Park | Attraction | Beach | Nightlife
  - vibe        → Exactly 3 descriptive words, space-separated (e.g. "dramatic volcanic surreal")
  - description → One punchy sentence under 90 chars about what makes it special
  - confidence  → "high" = native tag / creator reply / explicit mention; "medium" = 2+ consistent signals or composite inference; "low" = single weak signal

━━━ FINAL RULES ━━━
- Native tag / creator reply → confidence "high", use as primary source.
- Multiple DISTINCT spots visible → include ALL as separate objects.
- Truly no location identifiable → { "travel_spots": [] }
- Do NOT use location question comments as evidence. Do NOT hallucinate.
- No duplicate places. Valid JSON only — no markdown, no explanation.

━━━ CONTENT DATA ━━━
${context}
`;

  try {
    const response = await Promise.race([
      client.path("/chat/completions").post({
        body: {
          messages: [
            {
              role: "system",
              content:
                "You are a precise travel data extractor for VOYGE. You always return valid JSON only. Never add markdown, code fences, or explanation. Just the raw JSON object.",
            },
            { role: "user", content: prompt },
          ],
          model: "gpt-5",
          response_format: { type: "json_object" },
          // GPT-5 only supports the default temperature (1) — do not pass temperature
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("extractSpotData timeout after 25s")),
          25000,
        ),
      ),
    ]);

    if (response.status !== "200") {
      // @ts-ignore
      console.error("AI API Error:", response.body);
      throw new Error(`AI Request Failed with status: ${response.status}`);
    }

    // @ts-ignore
    const raw = response.body.choices[0].message.content;
    console.log(
      `[AI] Raw response (first 300 chars): ${raw.substring(0, 300)}`,
    );
    const content = JSON.parse(raw);
    console.log(
      `[AI] Extracted ${content?.travel_spots?.length ?? 0} spot(s):`,
      content?.travel_spots
        ?.map(
          (s: any) => `${s.name}, ${s.city}, ${s.country} [${s.confidence}]`,
        )
        .join(" | "),
    );
    return content;
  } catch (error) {
    console.error("AI Extraction Error:", error);
    throw error;
  }
}

// ─── Enhance (used by /api/enhance route) ────────────────────────────────────
export async function enhanceSpotData(
  name: string,
  city: string,
  country: string,
): Promise<{ category: string; vibe: string; description: string }> {
  const SAFE_DEFAULTS = {
    category: "Attraction",
    vibe: "scenic natural serene",
    description: `${name} — a remarkable place worth visiting.`.substring(
      0,
      80,
    ),
  };

  const prompt = `Generate rich travel metadata for this specific real-world location: "${name}, ${city}, ${country}".

Return ONLY a valid JSON object with exactly these keys:
- category    → One of: Food | Stay | View | Activity | Shopping | Museum | Park | Attraction | Beach | Nightlife
- vibe        → Exactly 3 descriptive words (e.g. "vibrant historic charming")
- description → One punchy sentence under 80 characters about what makes this place special
`;

  try {
    // Race the AI call against a 12-second timeout so we never hang the pipeline
    const response = await Promise.race([
      client.path("/chat/completions").post({
        body: {
          messages: [
            {
              role: "system",
              content: "You are a travel expert. Return only valid JSON.",
            },
            { role: "user", content: prompt },
          ],
          model: "gpt-5",
          response_format: { type: "json_object" },
          // GPT-5 only supports the default temperature (1) — do not pass temperature
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("enhanceSpotData timeout after 12s")),
          12000,
        ),
      ),
    ]);

    if (response.status !== "200") {
      console.warn(
        `[AI Enhance] Non-200 status ${response.status} — using defaults`,
      );
      return SAFE_DEFAULTS;
    }

    // @ts-ignore
    const raw = response.body?.choices?.[0]?.message?.content;
    if (!raw) {
      console.warn("[AI Enhance] Empty content in response — using defaults");
      return SAFE_DEFAULTS;
    }

    const content = JSON.parse(raw) as {
      category?: string;
      vibe?: string;
      description?: string;
    };
    return {
      category: content.category || SAFE_DEFAULTS.category,
      vibe: content.vibe || SAFE_DEFAULTS.vibe,
      description: content.description || SAFE_DEFAULTS.description,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[AI Enhance] Failed for "${name}, ${city}, ${country}": ${msg} — using defaults`,
    );
    return SAFE_DEFAULTS;
  }
}
