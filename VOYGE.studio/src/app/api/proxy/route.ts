/**
 * @fileoverview GET /api/proxy — Image Proxy for Social CDN CORS Bypass
 *
 * Fetches a remote image (typically from Instagram or TikTok CDNs) on the
 * server side and streams it back to the browser, bypassing CORS restrictions
 * that prevent the frontend from loading social media images directly.
 *
 * This is required because Instagram and TikTok serve thumbnails and video
 * covers from CDN domains (`cdninstagram.com`, `tiktokcdn.com`, etc.) that
 * set restrictive `Access-Control-Allow-Origin` headers, making them
 * inaccessible from browser `<img>` tags or `fetch()` calls originating from
 * a different domain.
 *
 * ## Request
 *
 * ```http
 * GET /api/proxy?url=https%3A%2F%2Fscontent.cdninstagram.com%2Fv%2F...
 * ```
 *
 * ### Query Parameters
 * | Param | Type     | Required | Description                               |
 * |-------|----------|----------|-------------------------------------------|
 * | `url` | `string` | ✅       | URL-encoded image URL to proxy            |
 *
 * ## Response — Success (`200 OK`)
 *
 * Returns the raw image bytes with:
 * - `Content-Type` — forwarded from the upstream CDN response
 *   (e.g. `image/jpeg`, `image/webp`)
 * - `Cache-Control: public, max-age=86400` — instructs the browser and any
 *   CDN layer to cache the proxied image for **24 hours**, reducing redundant
 *   upstream fetches for the same thumbnail.
 *
 * ## Response — Errors
 *
 * | Status | Condition                                        |
 * |--------|--------------------------------------------------|
 * | `400`  | `url` query parameter is missing                 |
 * | `500`  | Upstream fetch failed (network error, 4xx, 5xx)  |
 *
 * ## Request Headers Forwarded Upstream
 *
 * To avoid CDN bot-detection blocks the proxy sends:
 * - `User-Agent` — a common Chrome/Windows user-agent string
 * - `Referer`    — set to `https://www.instagram.com/` to satisfy CDN
 *   hotlink-protection checks on Instagram-hosted assets
 *
 * ## Usage in the App
 *
 * Used by:
 * - `MapComponent.tsx` — renders spot thumbnails in map popups
 * - `vision.ts` (Stage 4) — fetches the post thumbnail for Google Vision
 *   landmark detection; passes `/api/proxy?url=` as the proxy prefix
 *
 * @module api/proxy
 */
import { NextRequest, NextResponse } from "next/server";
import axios from "axios";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const imageUrl = searchParams.get("url");

  if (!imageUrl) {
    return new NextResponse("Missing URL", { status: 400 });
  }

  try {
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Referer: "https://www.instagram.com/",
      },
    });

    const contentType = response.headers["content-type"];
    return new NextResponse(response.data, {
      headers: {
        "Content-Type": contentType || "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error: any) {
    console.error("Proxy Error:", error.message);
    return new NextResponse("Error fetching image", { status: 500 });
  }
}
