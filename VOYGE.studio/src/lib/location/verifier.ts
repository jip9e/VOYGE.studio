/**
 * @fileoverview Stage 3 — Wikipedia + Google Knowledge Graph Verifier
 *
 * Confirms that a candidate place name extracted by the extractor (Stage 1)
 * refers to a real, known location and — where possible — retrieves
 * authoritative GPS coordinates directly from Wikipedia's GeoHack data.
 *
 * This stage runs **in parallel** with the geocoder (Stage 2) for each
 * candidate, so it adds minimal latency to the overall pipeline.
 *
 * ## Data Sources
 *
 * ### Wikipedia (MediaWiki API)
 * - Searches for the place name via the Wikipedia `opensearch` endpoint.
 * - Fetches the matching article's page properties to extract `geo.coordinates`
 *   (latitude + longitude embedded in the wikitext via the `{{coord}}` template).
 * - Also retrieves a short plain-text extract (first ~200 chars) for use as
 *   the spot's description.
 * - Entirely free; no API key required.
 *
 * ### Google Knowledge Graph Search API
 * - Queries the Knowledge Graph for the place name to get structured entity
 *   data: types (e.g. `["Place", "TouristAttraction"]`), a short description,
 *   and a relevance score.
 * - Used as a secondary signal to boost confidence when Wikipedia alone
 *   doesn't provide coordinates.
 * - Requires the `GOOGLE_KG_API_KEY` environment variable. If absent, this
 *   part of the verification is silently skipped.
 *
 * ## Title Match Scoring
 *
 * When Wikipedia returns results, the verifier scores how well the returned
 * article title matches the queried place name using a normalised string
 * similarity check:
 *
 * - **Exact match** (case-insensitive) → highest confidence boost
 * - **Starts-with / contains match** → moderate boost
 * - **Weak / no match** → result accepted but confidence kept low
 *
 * The final `VerificationResult.confidence` reflects both the title match
 * quality and whether authoritative coordinates were found.
 *
 * ## Confidence Multipliers (applied by pipeline.ts)
 *
 * The pipeline applies these multipliers to the base candidate confidence
 * based on the verification outcome:
 *
 * | Outcome                          | Multiplier |
 * |----------------------------------|------------|
 * | Wikipedia coordinates found      | × 1.15     |
 * | Knowledge Graph confirmed        | × 1.10     |
 * | Verified (no geo coords)         | × 1.05     |
 * | Not verified                     | × 0.90     |
 *
 * ## Exported Functions
 *
 * ### `verifyPlace(placeName, options?)`
 * Full verification: calls both Wikipedia and (if configured) Google Knowledge
 * Graph. Returns a `VerificationResult` with coordinates, article extract,
 * KG types, and an overall confidence score.
 *
 * Use this for the main pipeline where latency budget allows (~3–6 s).
 *
 * ### `quickVerify(placeName)`
 * Lightweight version: Wikipedia title lookup only (no coordinate extraction,
 * no Knowledge Graph call). Returns a boolean-like result quickly (~1–2 s).
 *
 * Use this inside the AI agent tool loop where speed matters more than depth.
 *
 * ## Exported Types
 *
 * - `VerificationResult` — Full verification result including wiki coords,
 *   article title/extract, KG description/types/score, and confidence.
 *
 * @module location/verifier
 */

// ─── Stage 3: Wikipedia + Google Knowledge Graph Verifier ────────────────────
// Verifies that a candidate place name is a real place, and retrieves
// authoritative coordinates from Wikipedia and/or Google Knowledge Graph.
// All APIs used here are free (Wikipedia) or have generous free tiers (KG).

export interface VerificationResult {
  verified: boolean;
  wikiCoords?: [number, number]; // [lng, lat] if Wikipedia has coordinates
  wikiTitle?: string; // canonical Wikipedia article title
  wikiExtract?: string; // short plain-text extract / description
  kgDescription?: string; // Google KG detailed description
  kgTypes?: string[]; // e.g. ["Place", "TouristAttraction"]
  kgScore?: number; // Google KG result score
  confidence: number; // 0.0 – 1.0 verification confidence
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fetch with timeout — aborts after timeoutMs */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalise a string for fuzzy comparison:
 * lowercase, strip punctuation, collapse whitespace.
 */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/['''"",.:;!?()\[\]{}<>\/\\|@#$%^&*+=~`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Rough title-match score between a query and a Wikipedia result title.
 * Returns a value in [0, 1].
 */
function titleMatchScore(query: string, title: string): number {
  const q = normalise(query);
  const t = normalise(title);

  if (q === t) return 1.0;
  if (t.startsWith(q) || q.startsWith(t)) return 0.9;

  // Count shared words
  const qWords = new Set(q.split(" ").filter((w) => w.length > 2));
  const tWords = t.split(" ").filter((w) => w.length > 2);
  if (qWords.size === 0) return 0;

  let matches = 0;
  for (const w of tWords) {
    if (qWords.has(w)) matches++;
  }
  return matches / qWords.size;
}

// ─── Wikipedia Search API ─────────────────────────────────────────────────────

interface WikiSearchResult {
  title: string;
  snippet: string;
  pageid: number;
}

async function searchWikipedia(name: string): Promise<WikiSearchResult[]> {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: name,
    srlimit: "5",
    format: "json",
    origin: "*",
  });

  const url = `https://en.wikipedia.org/w/api.php?${params}`;

  const res = await fetchWithTimeout(url, {
    timeoutMs: 8000,
    headers: { "User-Agent": "VOYGE/1.0 (travel discovery app)" },
  });

  if (!res.ok) {
    console.warn(`[Verifier] Wikipedia search HTTP ${res.status}`);
    return [];
  }

  const data = (await res.json()) as {
    query?: { search?: WikiSearchResult[] };
  };
  return data.query?.search ?? [];
}

// ─── Wikipedia Coordinates API ────────────────────────────────────────────────

interface WikiCoordResult {
  lat: number;
  lon: number;
}

async function getWikipediaCoords(
  title: string,
): Promise<WikiCoordResult | null> {
  const params = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "coordinates|extracts",
    exintro: "true",
    explaintext: "true",
    exsentences: "2",
    format: "json",
    origin: "*",
  });

  const url = `https://en.wikipedia.org/w/api.php?${params}`;

  const res = await fetchWithTimeout(url, {
    timeoutMs: 8000,
    headers: { "User-Agent": "VOYGE/1.0 (travel discovery app)" },
  });

  if (!res.ok) {
    console.warn(`[Verifier] Wikipedia coords HTTP ${res.status}`);
    return null;
  }

  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          coordinates?: { lat: number; lon: number }[];
          extract?: string;
        }
      >;
    };
  };

  const pages = data.query?.pages ?? {};
  const page = Object.values(pages)[0];
  if (!page) return null;

  const coord = page.coordinates?.[0];
  if (!coord) return null;

  return { lat: coord.lat, lon: coord.lon };
}

/** Get both coordinates AND the short extract for a Wikipedia title */
async function getWikipediaDetails(title: string): Promise<{
  coords: WikiCoordResult | null;
  extract: string | null;
}> {
  const params = new URLSearchParams({
    action: "query",
    titles: title,
    prop: "coordinates|extracts",
    exintro: "true",
    explaintext: "true",
    exsentences: "3",
    format: "json",
    origin: "*",
  });

  const url = `https://en.wikipedia.org/w/api.php?${params}`;

  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs: 8000,
      headers: { "User-Agent": "VOYGE/1.0 (travel discovery app)" },
    });

    if (!res.ok) return { coords: null, extract: null };

    const data = (await res.json()) as {
      query?: {
        pages?: Record<
          string,
          {
            coordinates?: { lat: number; lon: number }[];
            extract?: string;
          }
        >;
      };
    };

    const pages = data.query?.pages ?? {};
    const page = Object.values(pages)[0];
    if (!page) return { coords: null, extract: null };

    const coord = page.coordinates?.[0] ?? null;
    const extract = page.extract ?? null;

    return {
      coords: coord ? { lat: coord.lat, lon: coord.lon } : null,
      extract: extract ? extract.substring(0, 300).trim() : null,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[Verifier] Wikipedia details fetch failed: ${msg}`);
    return { coords: null, extract: null };
  }
}

// ─── Google Knowledge Graph API ───────────────────────────────────────────────

interface KGEntity {
  name: string;
  types: string[];
  description: string | null;
  detailedDescription: string | null;
  score: number;
}

const KG_PLACE_TYPES = new Set([
  "Place",
  "TouristAttraction",
  "NaturalFeature",
  "LandmarksOrHistoricalBuildings",
  "CivicStructure",
  "Park",
  "Beach",
  "Mountain",
  "BodyOfWater",
  "RiverBodyOfWater",
  "LakeBodyOfWater",
  "OceanBodyOfWater",
  "Waterfall",
  "Country",
  "City",
  "AdministrativeArea",
  "Continent",
  "Island",
  "LocalBusiness",
  "FoodEstablishment",
  "Museum",
  "SportsActivityLocation",
  "Hotel",
  "Accommodation",
  "Airport",
]);

async function queryKnowledgeGraph(name: string): Promise<KGEntity | null> {
  const apiKey = process.env.GOOGLE_KG_API_KEY;
  if (!apiKey) {
    console.log("[Verifier] GOOGLE_KG_API_KEY not set — skipping KG lookup");
    return null;
  }

  try {
    const params = new URLSearchParams({
      query: name,
      key: apiKey,
      limit: "5",
      // Filter to place-related types
      types: [
        "Place",
        "TouristAttraction",
        "NaturalFeature",
        "LandmarksOrHistoricalBuildings",
        "Country",
        "City",
        "AdministrativeArea",
      ].join(","),
    });

    const url = `https://kgsearch.googleapis.com/v1/entities:search?${params}`;
    const res = await fetchWithTimeout(url, { timeoutMs: 9000 });

    if (!res.ok) {
      console.warn(`[Verifier] KG API HTTP ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      itemListElement?: Array<{
        result?: {
          name?: string;
          "@type"?: string[];
          description?: string;
          detailedDescription?: { articleBody?: string };
        };
        resultScore?: number;
      }>;
    };

    const items = data.itemListElement ?? [];
    if (items.length === 0) return null;

    // Find best item that is a place-type entity
    for (const item of items) {
      const result = item.result;
      if (!result) continue;

      const types = result["@type"] ?? [];
      const isPlace = types.some((t) => KG_PLACE_TYPES.has(t));
      if (!isPlace) continue;

      return {
        name: result.name ?? name,
        types,
        description: result.description ?? null,
        detailedDescription: result.detailedDescription?.articleBody ?? null,
        score: item.resultScore ?? 0,
      };
    }

    // No place-type entity found — check if any entity looks like a place
    const first = items[0];
    if (first?.result) {
      const types = first.result["@type"] ?? [];
      return {
        name: first.result.name ?? name,
        types,
        description: first.result.description ?? null,
        detailedDescription:
          first.result.detailedDescription?.articleBody ?? null,
        score: first.resultScore ?? 0,
      };
    }

    return null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[Verifier] KG query failed: ${msg}`);
    return null;
  }
}

// ─── Main verifier ────────────────────────────────────────────────────────────

/**
 * Verify a candidate place name using Wikipedia and (optionally) the
 * Google Knowledge Graph.
 *
 * Strategy:
 * 1. Search Wikipedia — if top result title matches well, fetch coordinates.
 * 2. Query Google KG — confirms it's a known place entity, gets description.
 * 3. Combine signals into a confidence score and return VerificationResult.
 */
export async function verifyPlace(name: string): Promise<VerificationResult> {
  console.log(`[Verifier] Verifying "${name}"…`);

  let verified = false;
  let wikiCoords: [number, number] | undefined;
  let wikiTitle: string | undefined;
  let wikiExtract: string | undefined;
  let kgDescription: string | undefined;
  let kgTypes: string[] | undefined;
  let kgScore: number | undefined;
  let confidence = 0.0;

  // ── Step 1: Wikipedia search ─────────────────────────────────────────────
  let wikiMatchScore = 0;
  try {
    const searchResults = await searchWikipedia(name);

    if (searchResults.length > 0) {
      const top = searchResults[0];
      wikiMatchScore = titleMatchScore(name, top.title);

      console.log(
        `[Verifier] Wikipedia top result: "${top.title}" (match score: ${wikiMatchScore.toFixed(2)})`,
      );

      // Accept if the title is a reasonable match
      if (wikiMatchScore >= 0.6) {
        wikiTitle = top.title;
        verified = true;

        // Step 1b: Fetch coordinates + extract for the matched article
        const details = await getWikipediaDetails(top.title);

        if (details.coords) {
          wikiCoords = [details.coords.lon, details.coords.lat];
          console.log(
            `[Verifier] Wikipedia coords: [${details.coords.lat.toFixed(4)}, ${details.coords.lon.toFixed(4)}]`,
          );
        } else {
          console.log(`[Verifier] Wikipedia article found but no coordinates`);
        }

        if (details.extract) {
          wikiExtract = details.extract;
        }

        // Boost confidence based on match quality + whether we got coords
        confidence = 0.5 + wikiMatchScore * 0.3 + (details.coords ? 0.15 : 0);
      } else {
        // Weak match — try second result
        if (searchResults.length > 1) {
          const second = searchResults[1];
          const secondScore = titleMatchScore(name, second.title);
          if (secondScore > wikiMatchScore && secondScore >= 0.6) {
            wikiTitle = second.title;
            wikiMatchScore = secondScore;
            verified = true;

            const details = await getWikipediaDetails(second.title);
            if (details.coords) {
              wikiCoords = [details.coords.lon, details.coords.lat];
            }
            if (details.extract) {
              wikiExtract = details.extract;
            }
            confidence = 0.5 + secondScore * 0.3 + (details.coords ? 0.15 : 0);
            console.log(
              `[Verifier] Wikipedia second result used: "${second.title}" (score: ${secondScore.toFixed(2)})`,
            );
          }
        }

        if (!verified) {
          console.log(
            `[Verifier] Wikipedia match too weak (${wikiMatchScore.toFixed(2)}) — not verified via Wiki`,
          );
          confidence = wikiMatchScore * 0.3; // partial credit
        }
      }
    } else {
      console.log(`[Verifier] Wikipedia: no results for "${name}"`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[Verifier] Wikipedia step failed: ${msg}`);
  }

  // ── Step 2: Google Knowledge Graph ───────────────────────────────────────
  try {
    const kgEntity = await queryKnowledgeGraph(name);

    if (kgEntity) {
      const kgNameMatch = titleMatchScore(name, kgEntity.name);
      const isPlaceType = kgEntity.types.some((t) => KG_PLACE_TYPES.has(t));

      console.log(
        `[Verifier] KG entity: "${kgEntity.name}" types=[${kgEntity.types.join(", ")}] score=${kgEntity.score.toFixed(1)} nameMatch=${kgNameMatch.toFixed(2)}`,
      );

      if (kgNameMatch >= 0.5 && isPlaceType) {
        kgDescription =
          kgEntity.detailedDescription ?? kgEntity.description ?? undefined;
        kgTypes = kgEntity.types;
        kgScore = kgEntity.score;

        // KG confirmation significantly boosts confidence
        const kgBoost = isPlaceType ? 0.2 : 0.1;
        confidence = Math.min(1.0, confidence + kgBoost);
        verified = true;

        console.log(
          `[Verifier] KG confirmed place: types=[${kgTypes.join(", ")}] boost=+${kgBoost}`,
        );
      } else if (kgNameMatch >= 0.4) {
        // Weaker match — small boost only
        confidence = Math.min(1.0, confidence + 0.08);
        kgTypes = kgEntity.types;
      }
    } else {
      console.log(`[Verifier] KG: no matching entity for "${name}"`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[Verifier] KG step failed: ${msg}`);
  }

  // ── Step 3: Final confidence clamping ─────────────────────────────────────
  confidence = Math.min(1.0, Math.max(0.0, confidence));

  // If we have Wikipedia coordinates the result is highly trustworthy
  if (wikiCoords && verified) {
    confidence = Math.max(confidence, 0.85);
  }

  const result: VerificationResult = {
    verified,
    confidence,
    ...(wikiCoords !== undefined && { wikiCoords }),
    ...(wikiTitle !== undefined && { wikiTitle }),
    ...(wikiExtract !== undefined && { wikiExtract }),
    ...(kgDescription !== undefined && { kgDescription }),
    ...(kgTypes !== undefined && { kgTypes }),
    ...(kgScore !== undefined && { kgScore }),
  };

  console.log(
    `[Verifier] Result for "${name}": verified=${verified}, confidence=${confidence.toFixed(2)}` +
      (wikiCoords
        ? ` wikiCoords=[${wikiCoords[1].toFixed(4)}, ${wikiCoords[0].toFixed(4)}]`
        : "") +
      (kgTypes ? ` kgTypes=[${kgTypes.slice(0, 3).join(", ")}]` : ""),
  );

  return result;
}

/**
 * Lightweight verification that only checks Wikipedia search (no KG).
 * Used when we want a quick sanity-check without spending KG quota.
 */
export async function quickVerify(
  name: string,
): Promise<{ verified: boolean; coords?: [number, number] }> {
  try {
    const results = await searchWikipedia(name);
    if (results.length === 0) return { verified: false };

    const matchScore = titleMatchScore(name, results[0].title);
    if (matchScore < 0.55) return { verified: false };

    const coords = await getWikipediaCoords(results[0].title);
    return {
      verified: true,
      coords: coords ? [coords.lon, coords.lat] : undefined,
    };
  } catch {
    return { verified: false };
  }
}
