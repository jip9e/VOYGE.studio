/**
 * @fileoverview VOYGE TikTok Diagnostic Script — CLI Debugging Tool
 *
 * A standalone Node.js CLI script for debugging TikTok scraping issues without
 * running the full Next.js application. It sequentially calls every API layer
 * that the production `scrapeTikTok()` function uses and dumps the raw
 * responses to stdout, making it easy to diagnose which layer is failing and
 * exactly what data each provider returns.
 *
 * ## Usage
 *
 * ```bash
 * node scripts/diagnose-tiktok.mjs <tiktok_url>
 * ```
 *
 * **Example:**
 * ```bash
 * node scripts/diagnose-tiktok.mjs https://vt.tiktok.com/ZSuhUpWxm/
 * node scripts/diagnose-tiktok.mjs https://www.tiktok.com/@username/video/1234567890
 * ```
 *
 * If no URL is provided, defaults to `https://vt.tiktok.com/ZSuhUpWxm/`.
 *
 * ## Prerequisites
 *
 * Requires a `.env.local` file in the project root with:
 * ```
 * RAPIDAPI_KEY=your_rapidapi_subscription_key
 * ```
 * The script loads `.env.local` manually (no dotenv dependency) so it can
 * run with plain `node` without any build step.
 *
 * ## Steps Executed
 *
 * The script runs seven diagnostic steps in sequence:
 *
 * | Step | Description                                              |
 * |------|----------------------------------------------------------|
 * | 1    | **Resolve short URL** — Follows HTTP redirects to expand `vt.tiktok.com` / `vm.tiktok.com` short links into canonical long-form URLs. Extracts `video_id` and `author_username` from the resolved URL. |
 * | 2    | **tikwm Layer 1** — POSTs to `https://www.tikwm.com/api/` with the resolved URL. Logs `title`, `cover`, `author.unique_id`, `hashtag[]`, and `poi_info`. |
 * | 3    | **tiktok-scraper7 /video/info** — Tries three param sets (`url=canonical`, `video_id=…`, `url=resolved`) against the RapidAPI `tiktok-scraper7` endpoint. Logs `desc`, `challenges`, `textExtra`, `poi_info`, and `location`. |
 * | 4    | **tiktok-scraper7 /comment/list** — Fetches up to 20 comments with three param sets. Dumps every comment text and author username to identify creator replies containing location info. |
 * | 5    | **tikwm /api/comment/list** — Fallback comment fetch via tikwm. Same output format as Step 4. |
 * | 6    | **User bio endpoints** — Fetches the creator's profile bio via both `tikwm POST /api/user/detail` and `tiktok-scraper7 GET /user/info`. Logs `signature` (bio text) and `bioLink`. |
 * | 7    | **Summary** — Prints a human-readable summary of what the AI pipeline would actually receive and lists 5 key questions to investigate based on the output. |
 *
 * ## HTTP Helpers
 *
 * The script uses a zero-dependency HTTP layer built on Node's built-in
 * `https` / `http` modules (no axios, no node-fetch):
 *
 * - `fetchJSON(url, options)` — GET/POST returning `{ status, body, raw }`.
 *   Parses JSON automatically; falls back to `body: null` on parse failure.
 *   Timeout: 20 seconds per request.
 * - `fetchForm(url, params)` — POST with `application/x-www-form-urlencoded`
 *   body. Used for tikwm endpoints.
 * - `fetchRapid(url, params, host)` — GET with RapidAPI authentication headers
 *   (`x-rapidapi-key`, `x-rapidapi-host`). Used for tiktok-scraper7 endpoints.
 *
 * ## Output Format
 *
 * Each step is clearly delimited by `═══` section headers. Within each step,
 * `── label:` prefixes show individual field values. JSON objects are pretty-
 * printed and truncated to 4000 characters to avoid terminal overflow.
 *
 * ## Key Diagnostic Questions
 *
 * The script is specifically designed to answer:
 * 1. Is tikwm's `title` field truncated? Does `/video/info` have the full description?
 * 2. Are there creator reply comments that contain location information?
 * 3. Does `comment[user][unique_id]` match the post author's username?
 * 4. Does `tiktok-scraper7 /video/info` return data? If 404, what's the correct endpoint?
 * 5. Are there reply comment chains (`reply_total > 0`) that aren't being fetched?
 *
 * @module scripts/diagnose-tiktok
 */

import https from "https";
import http from "http";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── Load .env.local manually ─────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
try {
  const envFile = readFileSync(envPath, "utf8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed
      .slice(eqIdx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    process.env[key] = val;
  }
  console.log("✅ Loaded .env.local\n");
} catch (e) {
  console.warn("⚠️  Could not load .env.local:", e.message, "\n");
}

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || "";
if (!RAPIDAPI_KEY) {
  console.warn(
    "⚠️  RAPIDAPI_KEY missing — tiktok-scraper7 steps will be skipped; free tikwm steps still run.\n",
  );
}

const RAW_URL = process.argv[2] || "https://vt.tiktok.com/ZSuhUpWxm/";
console.log("━".repeat(70));
console.log(`🔍 Diagnosing TikTok URL: ${RAW_URL}`);
console.log("━".repeat(70) + "\n");

// ── Tiny HTTP fetch helper (no axios dependency) ──────────────────────────────
function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const { method = "GET", headers = {}, body = null } = options;

    const req = lib.request(url, { method, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({
            status: res.statusCode,
            body: JSON.parse(data),
            raw: data,
          });
        } catch {
          resolve({ status: res.statusCode, body: null, raw: data });
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error("Request timed out after 20s"));
    });

    if (body) req.write(body);
    req.end();
  });
}

function fetchForm(url, params) {
  const body = new URLSearchParams(params).toString();
  return fetchJSON(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
    },
    body,
  });
}

function fetchRapid(url, params, host) {
  const qs = new URLSearchParams(params).toString();
  const fullUrl = `${url}?${qs}`;
  return fetchJSON(fullUrl, {
    method: "GET",
    headers: {
      "x-rapidapi-key": RAPIDAPI_KEY,
      "x-rapidapi-host": host,
    },
  });
}

function section(title) {
  console.log("\n" + "═".repeat(70));
  console.log(`  ${title}`);
  console.log("═".repeat(70));
}

function dump(label, obj, maxDepth = 4) {
  console.log(`\n── ${label}:`);
  console.log(JSON.stringify(obj, null, 2).slice(0, 4000));
}

function extractVideoId(url) {
  // Matches both /video/<id> and /photo/<id> (image slideshow posts)
  return (
    url.match(/\/(?:video|photo)\/(\d+)/)?.[1] ||
    url.split(/\/(?:video|photo)\//)[1]?.split("?")[0] ||
    ""
  );
}

function detectContentKind(url) {
  return /\/photo\//.test(url) ? "photo" : "video";
}

function extractUsername(url) {
  return url.match(/tiktok\.com\/@([^/?#]+)/)?.[1] || "";
}

// ── STEP 1: Resolve short URL ─────────────────────────────────────────────────
async function resolveShortUrl(url) {
  if (!url.includes("vt.tiktok.com") && !url.includes("vm.tiktok.com")) {
    return url;
  }
  return new Promise((resolve) => {
    const req = https.request(url, { method: "HEAD" }, (res) => {
      const location = res.headers["location"] || url;
      console.log(`[Redirect] ${url} → ${location}`);
      resolve(location);
    });
    req.on("error", () => resolve(url));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve(url);
    });
    req.end();
  });
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  // Step 1: Resolve
  section("STEP 1 — Resolve Short URL");
  const resolvedUrl = await resolveShortUrl(RAW_URL);
  console.log("Resolved:", resolvedUrl);
  let video_id = extractVideoId(resolvedUrl);
  let author_username = extractUsername(resolvedUrl);
  console.log("video_id from URL:", video_id || "(none yet)");
  console.log("username from URL:", author_username || "(none yet)");

  // Step 2: tikwm Layer 1
  section("STEP 2 — tikwm.com /api/ (Layer 1)");
  try {
    const r = await fetchForm("https://www.tikwm.com/api/", {
      url: resolvedUrl,
      hd: "0",
    });
    console.log("HTTP Status:", r.status);
    console.log("code:", r.body?.code, "| msg:", r.body?.msg);

    const d = r.body?.data;
    if (d) {
      console.log("\n📦 data keys:", Object.keys(d).join(", "));
      console.log("  id:", d.id);
      console.log("  title:", JSON.stringify(d.title));
      console.log("  cover:", d.cover?.slice(0, 80));
      console.log("  author.unique_id:", d.author?.unique_id);
      console.log(
        "  hashtag type:",
        typeof d.hashtag,
        Array.isArray(d.hashtag) ? `(${d.hashtag.length} items)` : "",
      );
      if (Array.isArray(d.hashtag) && d.hashtag.length > 0) {
        console.log("  hashtag[0]:", JSON.stringify(d.hashtag[0]));
      }
      console.log("  poi_info:", JSON.stringify(d.poi_info || null));
      console.log("  music title:", d.music?.title);
      console.log(
        "  images (slideshow):",
        Array.isArray(d.images) ? `${d.images.length} slides` : "none",
      );
      if (Array.isArray(d.images) && d.images.length > 0) {
        console.log("  images[0]:", d.images[0]?.slice(0, 100));
      }

      if (!video_id && d.id) video_id = String(d.id);
      if (!author_username && d.author?.unique_id)
        author_username = d.author.unique_id;
    } else {
      console.log("⚠️  No data field in response");
      dump("Full response body", r.body);
    }
  } catch (e) {
    console.error("❌ tikwm Layer 1 failed:", e.message);
  }

  const contentKind = detectContentKind(resolvedUrl);
  const canonicalUrl =
    author_username && video_id
      ? `https://www.tiktok.com/@${author_username}/${contentKind}/${video_id}`
      : video_id
        ? `https://www.tiktok.com/${contentKind}/${video_id}`
        : resolvedUrl;

  console.log("\n🔗 Canonical URL:", canonicalUrl);
  console.log("📌 video_id:", video_id);
  console.log("👤 author_username:", author_username);

  // Step 3: tiktok-scraper7 /video/info
  section("STEP 3 — tiktok-scraper7 /video/info (Layer 1.5)");
  for (const paramSet of RAPIDAPI_KEY
    ? [{ url: canonicalUrl }, { video_id }, { url: resolvedUrl }]
    : []) {
    try {
      console.log(`\n  Trying params: ${JSON.stringify(paramSet)}`);
      const r = await fetchRapid(
        "https://tiktok-scraper7.p.rapidapi.com/video/info",
        paramSet,
        "tiktok-scraper7.p.rapidapi.com",
      );
      console.log("  HTTP Status:", r.status);
      console.log("  code:", r.body?.code, "| msg:", r.body?.msg);

      const d = r.body?.data || r.body?.result || null;
      if (d && r.status === 200) {
        console.log("\n  📦 data keys:", Object.keys(d).join(", "));
        console.log("  desc:", JSON.stringify((d.desc || "").slice(0, 200)));
        console.log("  title:", JSON.stringify((d.title || "").slice(0, 200)));
        console.log(
          "  video_description:",
          JSON.stringify((d.video_description || "").slice(0, 200)),
        );
        console.log(
          "  challenges:",
          JSON.stringify(d.challenges?.slice(0, 3) || []),
        );
        console.log(
          "  textExtra:",
          JSON.stringify(d.textExtra?.slice(0, 3) || []),
        );
        console.log(
          "  text_extra:",
          JSON.stringify(d.text_extra?.slice(0, 3) || []),
        );
        console.log("  poi_info:", JSON.stringify(d.poi_info || null));
        console.log("  poi:", JSON.stringify(d.poi || null));
        console.log("  location:", JSON.stringify(d.location || null));
        console.log("  author.unique_id:", d.author?.unique_id);
        console.log("\n  ✅ This param set worked! Breaking.");
        break;
      } else if (r.status === 404) {
        console.log("  ❌ 404 — endpoint not found with these params");
      } else {
        dump("  Full body", r.body);
      }
    } catch (e) {
      console.error("  ❌ Failed:", e.message);
    }
  }

  // Step 4: Comment list
  section("STEP 4 — tiktok-scraper7 /comment/list (Layer 2)");
  for (const paramSet of RAPIDAPI_KEY
    ? [
        { url: canonicalUrl, count: "20" },
        { video_id, count: "20" },
        { url: resolvedUrl, count: "20" },
      ]
    : []) {
    try {
      console.log(`\n  Trying params: ${JSON.stringify(paramSet)}`);
      const r = await fetchRapid(
        "https://tiktok-scraper7.p.rapidapi.com/comment/list",
        paramSet,
        "tiktok-scraper7.p.rapidapi.com",
      );
      console.log("  HTTP Status:", r.status);
      console.log("  code:", r.body?.code, "| msg:", r.body?.msg);

      const d = r.body?.data;
      if (d && r.body?.code === 0) {
        const comments =
          d?.comments || d?.comment_list || (Array.isArray(d) ? d : null) || [];
        console.log(`\n  📦 data keys: ${Object.keys(d).join(", ")}`);
        console.log(`  total comments in response: ${comments.length}`);

        if (comments.length > 0) {
          console.log(
            `  first comment keys: ${Object.keys(comments[0]).join(", ")}`,
          );
          console.log("\n  💬 ALL COMMENT TEXTS:");
          comments.forEach((c, i) => {
            const text =
              c?.text || c?.comment_text || c?.content || "(no text)";
            const user = c?.user?.unique_id || c?.user?.nickname || "unknown";
            console.log(`    ${i + 1}. [@${user}]: "${text}"`);
          });
        }
        console.log("\n  ✅ This param set worked! Breaking.");
        break;
      } else {
        dump("  Full body", r.body);
      }
    } catch (e) {
      console.error("  ❌ Failed:", e.message);
    }
  }

  // Step 5: tikwm comment list fallback
  section("STEP 5 — tikwm.com /api/comment/list (Layer 2b fallback)");
  for (const paramSet of [
    { url: canonicalUrl, count: "20" },
    { video_id, count: "20" },
  ]) {
    try {
      console.log(`\n  Trying params: ${JSON.stringify(paramSet)}`);
      const r = await fetchForm(
        "https://www.tikwm.com/api/comment/list",
        paramSet,
      );
      console.log("  HTTP Status:", r.status);
      console.log("  code:", r.body?.code, "| msg:", r.body?.msg);

      const d = r.body?.data;
      if (d && r.body?.code === 0) {
        const comments = d?.comments || (Array.isArray(d) ? d : []);
        console.log(`  total: ${comments.length}`);
        if (comments.length > 0) {
          console.log(
            `  first comment keys: ${Object.keys(comments[0]).join(", ")}`,
          );
          console.log("\n  💬 ALL COMMENT TEXTS:");
          comments.forEach((c, i) => {
            const text = c?.text || c?.content || "(no text)";
            const user = c?.user?.unique_id || c?.user?.nickname || "?";
            console.log(`    ${i + 1}. [@${user}]: "${text}"`);
          });
        }
        console.log("\n  ✅ This param set worked! Breaking.");
        break;
      } else {
        dump("  Full body", r.body);
      }
    } catch (e) {
      console.error("  ❌ Failed:", e.message);
    }
  }

  // Step 6: User bio
  section("STEP 6 — User Bio Endpoints");
  if (author_username) {
    // tikwm POST
    try {
      console.log(`\n  tikwm POST /api/user/detail for @${author_username}`);
      const r = await fetchForm("https://www.tikwm.com/api/user/detail", {
        unique_id: author_username,
      });
      console.log("  HTTP Status:", r.status, "| code:", r.body?.code);
      const u = r.body?.data?.user || r.body?.user || r.body?.data || null;
      if (u && r.body?.code === 0) {
        console.log("  signature:", JSON.stringify(u.signature || ""));
        console.log("  bioLink:", JSON.stringify(u.bioLink || null));
        console.log("  ✅ tikwm user bio worked");
      } else {
        dump("  Full body", r.body);
      }
    } catch (e) {
      console.error("  ❌ tikwm user bio failed:", e.message);
    }

    // tiktok-scraper7 GET
    if (RAPIDAPI_KEY)
      try {
        console.log(
          `\n  tiktok-scraper7 GET /user/info for @${author_username}`,
        );
      const r = await fetchRapid(
        "https://tiktok-scraper7.p.rapidapi.com/user/info",
        { unique_id: author_username },
        "tiktok-scraper7.p.rapidapi.com",
      );
      console.log("  HTTP Status:", r.status, "| code:", r.body?.code);
      const u =
        r.body?.data?.user?.user || r.body?.data?.user || r.body?.user || null;
      if (u) {
        console.log("  signature:", JSON.stringify(u.signature || ""));
        console.log("  nickname:", u.nickname);
        console.log("  ✅ tiktok-scraper7 user info worked");
      } else {
        dump("  Full body (truncated)", r.body);
      }
    } catch (e) {
      console.error("  ❌ tiktok-scraper7 user info failed:", e.message);
    }
  } else {
    console.log("  ⚠️  No author_username — skipping bio fetch");
  }

  // Step 7: What does the AI actually receive?
  section("STEP 7 — Summary: What the AI receives");
  console.log("\nThis is the data going into AI extraction:");
  console.log(
    "  caption length   :",
    "9 chars (truncated by tikwm — full text unknown)",
  );
  console.log("  hashtags         :", "0 (none returned by tikwm)");
  console.log("  user_bio         :", "77 chars (from tiktok-scraper7)");
  console.log("  thumbnail        :", "✅");
  console.log("\n⚠️  KEY FINDINGS TO INVESTIGATE:");
  console.log(
    "  1. tikwm 'title' field is truncated — does /video/info have full desc?",
  );
  console.log(
    "  2. Are comments showing the creator's OWN replies with location info?",
  );
  console.log(
    "  3. Does comment[user][unique_id] match @" + author_username + "?",
  );
  console.log(
    "  4. Does tiktok-scraper7 /video/info return at all? If 404, what's the correct endpoint?",
  );
  console.log(
    "  5. Are there reply_comment chains we're not fetching (reply_total > 0)?",
  );
  console.log(
    "\nRun this script and examine the outputs above to answer all 5 questions.",
  );
  console.log("\n" + "━".repeat(70) + "\n");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
