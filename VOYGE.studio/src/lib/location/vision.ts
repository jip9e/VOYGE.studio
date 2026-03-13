// ─── Stage 4: Google Cloud Vision Landmark Detection ─────────────────────────
// Given a thumbnail URL, fetches the image, calls Google Vision API landmark
// detection, and returns the landmark name + coordinates if confidence > 0.5.
// Gracefully skips if GOOGLE_VISION_KEY is not configured.

export interface VisionResult {
  landmark: string;
  coordinates: [number, number]; // [lng, lat]
  confidence: number;            // 0.0 – 1.0 (from Vision API score)
  source: "google_vision";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch with timeout — aborts after timeoutMs */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 12000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...fetchOptions, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a remote image and return it as a base64-encoded string (no data-URI
 * prefix — Vision API wants raw base64 in the `content` field).
 */
async function fetchImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    // Some social CDNs block direct server-side fetches; set a browser-like UA
    const res = await fetchWithTimeout(imageUrl, {
      timeoutMs: 12000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; VOYGE/1.0; +https://voyge.studio)",
        Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      console.warn(
        `[Vision] Image fetch HTTP ${res.status} for ${imageUrl.substring(0, 80)}`,
      );
      return null;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      console.warn(`[Vision] Unexpected content-type: ${contentType}`);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Convert to base64 in chunks to avoid stack-overflow on large images
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[Vision] Failed to fetch/encode image: ${msg}`);
    return null;
  }
}

// ─── Vision API types ─────────────────────────────────────────────────────────

interface VisionLatLng {
  latitude: number;
  longitude: number;
}

interface VisionLandmarkAnnotation {
  description: string;
  score: number;
  locations: Array<{
    latLng?: VisionLatLng;
  }>;
}

interface VisionAnnotateResponse {
  responses: Array<{
    landmarkAnnotations?: VisionLandmarkAnnotation[];
    error?: { code: number; message: string };
  }>;
}

// ─── Main Vision detector ─────────────────────────────────────────────────────

/**
 * Detect landmarks in a thumbnail image using Google Cloud Vision API.
 *
 * Returns the top landmark with its coordinates if score > 0.5.
 * Returns null if:
 * - GOOGLE_VISION_KEY is not set
 * - No thumbnail URL provided
 * - Image fetch fails
 * - No landmarks detected above the score threshold
 * - Any API error occurs
 */
export async function detectLandmark(
  thumbnailUrl: string | null,
): Promise<VisionResult | null> {
  const apiKey = process.env.GOOGLE_VISION_KEY;

  if (!apiKey) {
    console.log("[Vision] GOOGLE_VISION_KEY not set — skipping Vision step");
    return null;
  }

  if (!thumbnailUrl) {
    console.log("[Vision] No thumbnail URL provided — skipping Vision step");
    return null;
  }

  console.log(
    `[Vision] Fetching image for landmark detection: ${thumbnailUrl.substring(0, 80)}…`,
  );

  // ── Step 1: Fetch image as base64 ─────────────────────────────────────────
  const base64Image = await fetchImageAsBase64(thumbnailUrl);
  if (!base64Image) {
    console.warn("[Vision] Could not encode image — skipping Vision step");
    return null;
  }

  console.log(
    `[Vision] Image encoded (${Math.round((base64Image.length * 3) / 4 / 1024)} KB) — calling Vision API…`,
  );

  // ── Step 2: Call Vision API ────────────────────────────────────────────────
  const requestBody = {
    requests: [
      {
        image: {
          content: base64Image,
        },
        features: [
          {
            type: "LANDMARK_DETECTION",
            maxResults: 5,
          },
        ],
        imageContext: {
          // Hint Vision to look for landmarks worldwide
          latLongRect: {
            minLatLng: { latitude: -90, longitude: -180 },
            maxLatLng: { latitude: 90, longitude: 180 },
          },
        },
      },
    ],
  };

  try {
    const res = await fetchWithTimeout(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        timeoutMs: 15000,
      },
    );

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.warn(
        `[Vision] Vision API HTTP ${res.status}: ${errorText.substring(0, 200)}`,
      );
      return null;
    }

    const data = (await res.json()) as VisionAnnotateResponse;

    // ── Step 3: Parse response ───────────────────────────────────────────────
    const response = data.responses?.[0];
    if (!response) {
      console.warn("[Vision] Empty response array from Vision API");
      return null;
    }

    if (response.error) {
      console.warn(
        `[Vision] Vision API error ${response.error.code}: ${response.error.message}`,
      );
      return null;
    }

    const annotations = response.landmarkAnnotations ?? [];
    if (annotations.length === 0) {
      console.log("[Vision] No landmark annotations in image");
      return null;
    }

    // Log all detections for debugging
    annotations.forEach((ann, i) => {
      console.log(
        `[Vision]   ${i + 1}. "${ann.description}" score=${ann.score.toFixed(3)}` +
          (ann.locations[0]?.latLng
            ? ` @ [${ann.locations[0].latLng.latitude.toFixed(4)}, ${ann.locations[0].latLng.longitude.toFixed(4)}]`
            : " (no coords)"),
      );
    });

    // ── Step 4: Pick best annotation above threshold ─────────────────────────
    const SCORE_THRESHOLD = 0.5;
    const best = annotations[0]; // Already sorted by score descending

    if (best.score < SCORE_THRESHOLD) {
      console.log(
        `[Vision] Top landmark "${best.description}" score=${best.score.toFixed(3)} below threshold ${SCORE_THRESHOLD} — ignoring`,
      );
      return null;
    }

    // Require coordinates — a landmark without a location is not useful
    const locationEntry = best.locations.find((loc) => loc.latLng != null);
    if (!locationEntry?.latLng) {
      console.log(
        `[Vision] Landmark "${best.description}" has no coordinates — ignoring`,
      );
      return null;
    }

    const { latitude, longitude } = locationEntry.latLng;

    console.log(
      `[Vision] ✅ Landmark detected: "${best.description}" score=${best.score.toFixed(3)} ` +
        `@ [${latitude.toFixed(4)}, ${longitude.toFixed(4)}]`,
    );

    return {
      landmark: best.description,
      coordinates: [longitude, latitude],
      confidence: best.score,
      source: "google_vision",
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[Vision] Vision API call failed: ${msg}`);
    return null;
  }
}

/**
 * Attempt landmark detection with a fallback to a proxy URL if the direct
 * fetch fails (useful when social CDNs block server-side requests).
 *
 * If `proxyBase` is provided (e.g. "/api/proxy?url="), the URL is re-tried
 * through the proxy on failure.
 */
export async function detectLandmarkWithFallback(
  thumbnailUrl: string | null,
  proxyBase?: string,
): Promise<VisionResult | null> {
  // Try direct URL first
  const direct = await detectLandmark(thumbnailUrl);
  if (direct) return direct;

  // If a proxy base is configured and we have a URL, retry via proxy
  if (proxyBase && thumbnailUrl) {
    const proxied = `${proxyBase}${encodeURIComponent(thumbnailUrl)}`;
    console.log("[Vision] Retrying via proxy…");
    return detectLandmark(proxied);
  }

  return null;
}
