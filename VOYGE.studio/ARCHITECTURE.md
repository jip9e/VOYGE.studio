# VOYGE.studio — Technical Architecture

> A deep-dive into how VOYGE turns a pasted social media URL into a precise map pin.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Data Flow — URL to Map Pin](#2-data-flow--url-to-map-pin)
3. [Location Extraction Pipeline](#3-location-extraction-pipeline)
   - [Stage 1 — Zero-Compute Extractor](#stage-1--zero-compute-extractor-extractorts)
   - [Stage 2 — Multi-API Geocoder Cascade](#stage-2--multi-api-geocoder-cascade-geocoderts)
   - [Stage 3 — Wikipedia + Knowledge Graph Verification](#stage-3--wikipedia--knowledge-graph-verification-verifierts)
   - [Stage 4 — Google Vision Landmark Detection](#stage-4--google-vision-landmark-detection-visionts)
   - [Stage 5 — AI Tool-Calling Agent](#stage-5--ai-tool-calling-agent-ai-agentts)
4. [Scraper Architecture](#4-scraper-architecture)
5. [Confidence Scoring](#5-confidence-scoring)
6. [Caching](#6-caching)
7. [Map Styles](#7-map-styles)
8. [API Routes](#8-api-routes)
9. [Key Thresholds & Tuning](#9-key-thresholds--tuning)

---

## 1. Overview

VOYGE.studio is a travel intelligence platform that extracts structured, geocoded location data from unstructured social media posts (Instagram Reels, TikTok videos). The core challenge is that social media creators almost never provide a clean address — location must be inferred from a noisy combination of captions, hashtags, comments, GPS tags, thumbnails, and bio text.

The system is built on **Next.js App Router** with Vercel Serverless Functions, **Firebase Firestore** for persistence and authentication, and **Mapbox GL JS v3** for rendering.

### Core Principle

Every piece of text associated with a post is treated as a potential location signal. Signals are ranked by source reliability, geocoded against multiple APIs in a confidence-weighted cascade, optionally verified against Wikipedia and the Google Knowledge Graph, and — as a last resort — handed to a GPT-5 tool-calling agent that can issue structured geocoding queries.

---

## 2. Data Flow — URL to Map Pin

```
User pastes URL
       │
       ▼
 POST /api/analyze
       │
       ▼
 engine.ts → processPost()
   ├── scrapeInstagram()  (if instagram.com)
   └── scrapeTikTok()     (if tiktok.com)
       │
       ▼
 RichPostData
   { caption, hashtags, top_comments, user_bio,
     location_name, location_lat/lng, thumbnail,
     author_username, _creatorComments,
     _anchorLocations, _compositeHints }
       │
       ▼
 extractLocation(signals)          ← src/lib/location/pipeline.ts
   ├── Stage 1: extractCandidates()
   ├── Stage 2: geocodePlace()     (parallel per candidate)
   ├── Stage 3: verifyPlace()      (parallel with Stage 2)
   ├── Stage 4: detectLandmark()   (parallel with Stages 2+3)
   └── Stage 5: runAIAgent()       (only if confidence < 0.60)
       │
       ▼
 LocationResult
   { name, city, country, coordinates,
     confidence, confidence_label, source_chain }
       │
       ▼
 POST /api/enhance  (optional — AI description + Pexels image)
       │
       ▼
 Saved to Firebase Firestore
       │
       ▼
 Rendered as map pin on Mapbox GL JS map
```

---

## 3. Location Extraction Pipeline

The pipeline lives entirely in `src/lib/location/`. Its public entry-point is `extractLocation(signals)` in `pipeline.ts`. The five stages run in a carefully ordered cascade; early stages are zero-cost and fast, later stages are progressively more expensive.

```
Candidates ──► Geocode + Verify (parallel) ──► Best result?
    │                                               │
    │                                        YES ──► return
    │                                               │
    │                                        NO  ──► Vision ──► return?
    │                                                               │
    └───────────────────────────────────────────────────────► AI Agent
```

---

### Stage 1 — Zero-Compute Extractor (`extractor.ts`)

**Purpose:** Extract all plausible place-name candidates from raw text signals without making any network calls.

**Input:** A `LocationSignals` object containing caption, hashtags, top_comments, user_bio, location_name (native GPS tag), author_username, `_creatorComments`, `_anchorLocations`, and `_compositeHints`.

**Output:** An array of `CandidatePlace` objects, each with a `name`, `raw` (original text), `source` type, and a raw `confidence` score (0–1).

#### Signal Sources (processed in priority order)

| Priority | Source | Signal Type | Description |
|----------|--------|-------------|-------------|
| 1 | `native_gps` | `location_name` + `location_lat/lng` | Platform-provided GPS tag — most reliable signal available |
| 2 | `anchor_location` | `_anchorLocations[]` | Location strings embedded in video metadata (TikTok POI tags) |
| 3 | `pin_emoji` | Caption / comments | 📍 pin emoji followed by place name — very intentional |
| 4 | `creator_reply` | `_creatorComments[]` | Comments posted by the creator themselves |
| 5 | `caption_explicit` | Caption text | Regex patterns: `"This is …"`, `"at [Place]"`, `"in [Place]"`, `"located in …"` |
| 6 | `geo_hashtag` | `hashtags[]` | Hashtags matched against `KNOWN_GEO_HASHTAGS` (500+ entries) |
| 7 | `tagged_account` | Mentions in caption/comments | `@visitmorocco`, `@traveloregon` etc. matched against `TOURISM_ACCOUNT_MAP` |
| 8 | `bio_based` | `user_bio` | Creator's bio parsed for location patterns (`"Based in …"`, `"📍 …"`) |
| 9 | `comment_answer` | `top_comments[]` | Non-creator comments that contain known geo-words and match answer patterns |
| 10 | `music_title` | Audio track name | Track title matched against `MUSIC_TITLE_PLACES` lookup table |

#### Comment Vote Triangulation

When processing `top_comments`, the extractor performs a **vote triangulation** pass:

1. A pool of all comment text (non-creator) is collected.
2. For each candidate place name already discovered, the extractor counts how many distinct comments mention that place (or a close variant).
3. If a place name receives ≥ 2 independent comment votes, its confidence is boosted:
   - 2 votes → `comment_answer` confidence × 1.15
   - 3+ votes → `comment_answer` confidence × 1.30
4. Candidates that are pure "question" comments (e.g. `"where is this?"`) are identified via `LOCATION_QUESTION_PATTERNS` and their confidence is penalised — they provide weak evidence.

#### Geo-Word Vote Pass

After per-signal extraction, a final **geo-word vote pass** scans all text for words present in `GEO_WORD_WHITELIST` (a large curated list of place names, landmarks, and geographic terms). Words that appear in ≥ 2 distinct signal sources (caption + comment, hashtag + bio, etc.) are promoted to low-confidence candidates if not already present.

#### Derived-Location Poisoning Prevention

Raw comment text is **sanitised** before being used as a `location_name`. Specifically:

- Filler phrases (`"Where is this?"`, `"What a beautiful place!"`) are stripped.
- Text containing only generic travel words (`waterfall`, `beach`, `mountains`, `hidden gem`) without a proper noun is rejected.
- Place names derived from comments are capped at a maximum confidence of `0.65` regardless of vote count, preventing noisy comment text from bypassing the geocoder confidence floor.

The `GENERIC_WORDS` blocklist (~110 entries) ensures that terms like `"nature"`, `"vibes"`, `"travel goals"`, or `"aesthetic"` are never surfaced as candidate place names.

---

### Stage 2 — Multi-API Geocoder Cascade (`geocoder.ts`)

**Purpose:** Convert each candidate place name into precise `[longitude, latitude]` coordinates with a geocoder confidence score.

**Input:** A `CandidatePlace` + optional context (country hint, region hint, `isNaturalFeature` flag).

**Output:** A `GeocoderResult` with `coordinates`, `full_address`, `city`, `country`, `mapbox_id`, `confidence`, and `source`.

#### Geocoder Order

The geocoders are tried in sequence. Each geocoder has a per-request timeout (via `fetchWithTimeout`). If a geocoder returns a result with confidence ≥ `CONFIDENCE_THRESHOLD`, the cascade short-circuits and returns immediately.

```
1. Mapbox SearchBox v1     (natural language, best for POIs)
        │  confidence ≥ threshold? ──► return
        ▼
2. Mapbox Geocoding v5     (structured, bbox + proximity bias)
        │  confidence ≥ threshold? ──► return
        ▼
3. Nominatim (OSM)         (free, good for cities & regions)
        │  confidence ≥ threshold? ──► return
        ▼
4. GeoNames                (strong for natural features)
        │  confidence ≥ threshold? ──► return
        ▼
5. HERE Geocoding          (commercial fallback, high accuracy)
        │  confidence ≥ threshold? ──► return
        ▼
6. OpenCage                (aggregator — last commercial fallback)
        │  confidence ≥ threshold? ──► return
        ▼
7. Overpass OSM            (last resort for natural features:
                            rivers, lakes, waterfalls, mountains,
                            beaches — uses OSM tag matching)
```

#### Country Hinting

If a country can be inferred from the candidate (e.g. from a hashtag like `#visitmorocco` or bio text like `"Based in Japan"`), `toCountryCode()` maps the country name/hint to an ISO 3166-1 alpha-2 code that is passed as a `country` bias parameter to Mapbox and a `countryCode` parameter to OpenCage and HERE. This significantly improves accuracy when the place name is ambiguous (e.g. `"Victoria"` could be Australia, Canada, or Kenya).

#### Natural Feature Routing

If `isNaturalFeature` is `true` on the candidate (detected from keywords like `river`, `waterfall`, `lake`, `canyon`, `glacier`), GeoNames is promoted in the cascade order (it has superior natural feature coverage), and Overpass OSM is always attempted as a final pass. Overpass queries use OSM tag matching:

| Feature word | OSM key | OSM value |
|---|---|---|
| river / stream | `waterway` | `river` / `stream` |
| lake / reservoir | `natural` | `water` |
| waterfall | `waterway` | `waterfall` |
| mountain / peak | `natural` | `peak` |
| beach | `natural` | `beach` |

---

### Stage 3 — Wikipedia + Knowledge Graph Verification (`verifier.ts`)

**Purpose:** Cross-reference a geocoded result against Wikipedia and the Google Knowledge Graph to confirm the place is real, refine its coordinates, and enrich it with a short description.

**Input:** Geocoded place name + optional country hint.

**Output:** A `VerificationResult` with `verified` (boolean), `wikiCoords` (may be more precise than geocoder), `wikiTitle`, `wikiExtract` (first sentence), `kgDescription`, `kgTypes[]`, `kgScore`, and an adjusted `confidence`.

#### Wikipedia Flow

1. **Search** — calls `Wikipedia Search API` (`action=query&list=search`) with the place name. Returns up to 5 candidate article titles.
2. **Title match scoring** — `titleMatchScore()` computes a fuzzy word-overlap score between the query and each returned title. The top-scoring article is selected.
3. **Coordinates + extract** — a second API call fetches `prop=coordinates|extracts` for the selected title, returning the article's canonical lat/lng and intro text.
4. If Wikipedia coordinates are available and the article title has a match score ≥ 0.6, `wikiCoords` replaces the geocoder coordinates in the final result (Wikipedia coordinates are often more precise for landmarks).

#### Knowledge Graph Flow

1. Calls the **Google Knowledge Graph Search API** (`GOOGLE_KG_API_KEY`) with the place name and a broad `types` filter covering all place entity types.
2. The returned `@type` array is checked against `KG_PLACE_TYPES` — a curated list of 30+ KG type strings (e.g. `LandmarksOrHistoricalBuildings`, `NaturalFeature`, `City`, `Country`, `AdministrativeArea`).
3. If a matching entity is found with `resultScore > 50`, confidence is boosted by up to `+0.12` depending on the score magnitude.
4. The KG `description` and `detailedDescription` are stored for use in the final result's description field.

**Note:** Stage 3 runs **in parallel** with Stage 2 for each candidate. The pipeline uses `Promise.allSettled` so a slow or failing verifier never blocks geocoding results.

---

### Stage 4 — Google Vision Landmark Detection (`vision.ts`)

**Purpose:** Detect well-known landmarks directly from the post's thumbnail image — a completely independent signal path that does not rely on text at all.

**Input:** `thumbnailUrl` from the scraped post.

**Output:** A `VisionResult` with `landmark` name, `coordinates [lng, lat]`, `confidence` (0–1 from Vision API score), and `source: "google_vision"`.

#### Process

1. The thumbnail image is fetched server-side with a browser-like `User-Agent` to avoid CDN blocks. The raw bytes are base64-encoded in 8 KB chunks (to avoid V8 stack overflow on large images).
2. A `LANDMARK_DETECTION` request is sent to `https://vision.googleapis.com/v1/images:annotate` with `maxResults: 5`.
3. The top annotation is selected. If its `score < 0.5`, the result is discarded.
4. The landmark must have associated coordinates in the `locations[]` array — a detection without coordinates is not useful and is dropped.
5. If the direct image fetch fails (social CDN blocking), `detectLandmarkWithFallback()` re-attempts via `/api/proxy?url=` — a server-side image proxy that sets the correct `Referer` header.

Stage 4 runs **in parallel with Stages 2 and 3** (`visionPromise` is launched at the same time as the geocoding loop). Its result is held and only consumed after the geocoding pass completes — if the geocoder already found a high-confidence result, the vision result is discarded.

**Skipped if:** `GOOGLE_VISION_KEY` is not set, or no thumbnail URL is available.

---

### Stage 5 — AI Tool-Calling Agent (`ai-agent.ts`)

**Purpose:** Last-resort location extraction using GPT-5 with structured tool calls. Activated only when all prior stages return a confidence below `AI_AGENT_THRESHOLD` (0.60).

**Input:** The full `LocationSignals` object, assembled into a rich structured prompt by `buildSignalContext()`.

**Output:** An `AIAgentResult` with `name`, `city`, `country`, `coordinates`, `full_address`, `confidence`, `source_chain`, `category`, `vibe`, and `description`.

#### Signal Context Construction

`buildSignalContext()` assembles an ordered, annotated prompt from all available signals:

1. **Native location tag** — labelled as HIGHEST CONFIDENCE
2. **Anchor locations** — labelled as very reliable (from video metadata)
3. **Creator's own comments** — labelled as HIGHEST TRUST (the creator filmed it)
4. **Pre-extracted signals** — structured list from `extractLocationSignals()`, ranked by confidence (🟢/🟡/🔴)
5. **Composite hints** — region + environment type combinations (e.g. `"river in Oregon"`)
6. **Caption** — truncated to 1200 chars
7. **Hashtags** — up to 40 tags
8. **Creator bio**
9. **Comments** — split into three buckets:
   - 💬 **Location-relevant answers** — comments matching `LOCATION_ANSWER_PATTERNS`
   - ❓ **Location questions** — explicitly labelled as NOT evidence
   - 💬 **Neutral comments** — only shown if no answers or creator comments exist

The clear separation of answers vs. questions is critical — without it, the model was treating `"Where is this place??"` as a location hint.

#### Available Tools

The agent has four tools it can call in any order:

| Tool | Description |
|------|-------------|
| `search_place` | Forward geocode: calls `geocodePlace()` with `query` + optional `country_hint` |
| `verify_place` | Wikipedia + KG verification: calls `verifyPlace()` with a `name` |
| `find_natural_feature` | OSM Overpass query for rivers, lakes, waterfalls, mountains, beaches with optional `region` and `name_hint` |
| `reverse_geocode` | Nominatim reverse geocode: given `lat` + `lng`, returns a structured address |

#### Agentic Loop

```
iteration 1..MAX_ITERATIONS (4):
  ├── Check agentDeadline (45s global timeout)
  ├── POST /chat/completions  (tool_choice: "auto" for iter 1–3, "none" for iter 4)
  ├── If response.finish_reason == "tool_calls":
  │     ├── Parse tool call arguments
  │     ├── executeTool() with per-tool timeout
  │     └── Append tool result to messages
  └── If response.finish_reason == "stop":
        └── Parse JSON result from content → return AIAgentResult
```

- **45-second global deadline** — `agentDeadline = Date.now() + 45_000`. Each iteration checks this before making the next API call.
- **MAX_ITERATIONS = 4** — prevents runaway loops. On the final iteration, `tool_choice: "none"` forces the model to produce its JSON answer.
- **Per-tool timeouts** — each `executeTool()` call wraps its underlying geocoding/verification call in its own timeout to prevent a single slow API from stalling the entire agent.
- **`response_format: { type: "json_object" }`** — enforced on the final iteration to guarantee parseable output.

The final JSON output is parsed for `name`, `city`, `country`, `coordinates` (as `[lng, lat]` or `{ lat, lng }`), `confidence`, `category`, `vibe`, and `description`.

---

## 4. Scraper Architecture

The scraper layer lives in `src/lib/scrapers.ts`. It exposes two main functions: `scrapeInstagram(url)` and `scrapeTikTok(url)`. Both return a `RichPostData` object that feeds directly into the location pipeline.

### Instagram Scraper (`scrapeInstagram`)

Instagram scraping uses a multi-layer fallback chain via RapidAPI:

```
Layer 1: instagram-scraper-api2  (v1)
         host: instagram-scraper-api2.p.rapidapi.com
         endpoint: /v1/post_info?code_or_id_or_url=<shortcode>
              │ success? ──► extract data
              │ fail / empty?
              ▼
Layer 2: instagram-scraper-api2  (v1.1 — alternate endpoint)
         endpoint: /v1.1/post_info?code_or_id_or_url=<shortcode>
              │ success? ──► extract data
              │ fail / empty?
              ▼
Layer 3: instagram120
         host: instagram120.p.rapidapi.com
         endpoint: /reels/<shortcode>
              │ success? ──► extract data
              │ fail / empty?
              ▼
Layer 4: oEmbed (no API key required)
         https://api.instagram.com/oembed?url=<canonicalUrl>
         (caption only — no comments, no geo)
```

After media data is retrieved, a **comments pass** is performed:
- Top comments are fetched from the API.
- Replies to high-engagement comments are fetched separately (up to 5 comment threads).
- `extractCreatorComments()` filters comments to identify those posted by the creator's own account (matched by `unique_id`, `uniqueId`, or `nickname` against `author_username`).
- `filterUsefulComments()` classifies all comments as answers, questions, or neutral.

A **profile pass** fetches the creator's bio to extract `user_bio`.

#### Derived Location (Instagram)

After all signals are collected, `extractLocationSignals()` is called on the full signal set. If the best signal has confidence ≥ 0.65 (`creatorGeoSignal`), the `location_name` field is set from it — but only if it passes the **derived-location poisoning check**: the raw text is sanitised and rejected if it contains only generic words.

### TikTok Scraper (`scrapeTikTok`)

TikTok scraping uses two API providers:

```
Primary: tikwm.com (no RapidAPI key needed for basic info)
         POST https://www.tikwm.com/api/?hd=1
              │ success? ──► extract data
              │ fail / empty?
              ▼
Fallback: tiktok-scraper7 via RapidAPI
          host: tiktok-scraper7.p.rapidapi.com
          endpoint: /video/info?url=<videoUrl>
```

TikTok provides richer structured data than Instagram:

- **`anchorTags`** in the video response — these are TikTok's own POI (Point of Interest) metadata embedded in the video. When present, they provide highly reliable location names that are extracted as `_anchorLocations`.
- **`challengeTags`** — TikTok's structured hashtag objects, richer than plain text hashtag extraction.
- **`poi` / `poiName`** — a dedicated location field in TikTok's video metadata, separate from the text caption.

The comment pipeline mirrors Instagram: top comments are fetched, replies are expanded, creator comments are identified and separated into `_creatorComments`, and `filterUsefulComments()` classifies the remainder.

### Shared Extracted Fields

Both scrapers produce the same `RichPostData` shape:

| Field | Description |
|-------|-------------|
| `caption` | Full post caption / description |
| `hashtags` | Array of hashtag strings (without `#`) |
| `thumbnail` | Best-quality thumbnail URL |
| `location_name` | Native GPS tag name (platform-provided) or derived |
| `location_lat` / `location_lng` | Native GPS coordinates if available |
| `author_username` | Creator's handle |
| `top_comments` | Up to ~50 top comments (flat strings) |
| `user_bio` | Creator's profile bio |
| `_creatorComments` | Comments identified as posted by the creator |
| `_anchorLocations` | Location strings from video metadata (TikTok POI tags) |
| `_compositeHints` | Region + environment type combinations pre-built by `buildCompositeHints()` |

---

## 5. Confidence Scoring

### Source Confidence Floors (`SOURCE_CONFIDENCE_FLOORS`)

Each signal source has a **floor** — the minimum raw confidence that a candidate from that source enters the geocoding pipeline with, regardless of extraction heuristics:

| Source | Floor | Rationale |
|--------|-------|-----------|
| `native_gps` | **1.00** | Platform-verified GPS — ground truth |
| `anchor_location` | **0.97** | TikTok POI metadata — nearly as reliable as GPS |
| `pin_emoji` | **0.95** | Intentional 📍 placement by creator |
| `creator_reply` | **0.90** | Creator knows where they filmed |
| `caption_explicit` | **0.85** | Direct textual claim in caption |
| `geo_hashtag` | **0.80** | Deliberate geo-tagging with known hashtag |
| `tagged_account` | **0.70** | Tourism board tag implies location |
| `comment_answer` | **0.65** | Third-party answer — reliable but not certain |
| `bio_based` | **0.60** | Creator's home base — useful but may not match post |
| `music_title` | **0.50** | Weak signal — thematic, not geographic |

### Final Confidence Computation

The final confidence stored on a `LocationResult` is computed by `computeFinalConfidence()`:

```
raw_confidence  = max(candidate.confidence, SOURCE_CONFIDENCE_FLOOR[source])

geocoder_mult   = multiplier based on geocoder used:
                    native_gps      → 1.00
                    mapbox_searchbox → 0.95
                    mapbox_v5        → 0.90
                    nominatim        → 0.85
                    geonames         → 0.82
                    here             → 0.88
                    opencage         → 0.80
                    overpass_osm     → 0.75

verification_mult = 1.10 if Wikipedia verified
                    1.05 if KG verified only
                    1.00 if not verified

final = min(1.0,  raw_confidence × geocoder_mult × verification_mult)
```

### Confidence Labels

| Range | Label |
|-------|-------|
| ≥ 0.90 | `"high"` |
| ≥ 0.70 | `"medium"` |
| ≥ 0.50 | `"low"` |
| < 0.50 | `"very_low"` |

---

## 6. Caching

The pipeline uses a two-layer cache to avoid redundant processing of the same post.

### Layer 1 — LRU In-Memory Cache

`resultCache` is an LRU cache (max 500 entries) keyed by a hash of the signals object. The cache key is built by `buildCacheKey()` which hashes:

- `platform`
- `author_username`
- `location_name` (if present)
- First 100 chars of `caption`
- First 5 hashtags

This means the same post hit twice in the same server process (common with Telegram bot re-forwards) returns instantly from memory.

### Layer 2 — Firebase Firestore Cache

Processed posts are written to Firestore with a `cachedAt` timestamp. The engine checks Firestore before invoking the scraper:

- **TTL: 7 days** — documents older than 7 days are re-processed.
- Cache hits skip both scraping and the full location pipeline.
- Cache key: the canonical post URL (normalized to remove tracking parameters).

---

## 7. Map Styles

The Mapbox GL JS map supports three style modes, toggled via a style switcher in the UI:

| Mode | Style ID | Description |
|------|----------|-------------|
| Dark | `mapbox://styles/mapbox/dark-v11` | Default — high-contrast dark globe |
| Satellite | `mapbox://styles/mapbox/satellite-streets-v12` | Satellite imagery with street labels |
| Outdoors | `mapbox://styles/mapbox/outdoors-v12` | Terrain-focused with elevation contours |

### Fog Configuration

All three styles use Mapbox's atmospheric fog layer for the 3D globe effect:

```json
{
  "range": [0.5, 10],
  "color": "#242B4B",
  "horizon-blend": 0.1
}
```

Fog colour is adjusted per style: dark mode uses deep navy (`#242B4B`), satellite uses a lighter atmospheric haze, and outdoors uses a pale sky tone.

### Style Change Handling

When the user switches styles, the map fires a `style.load` event. The application listens for this event and **re-applies** all dynamic sources and layers that were attached to the previous style:

1. The optimized route GeoJSON source (`voyge-route`) is re-added.
2. The route line layer and animated glow layers are re-added on top.
3. Spot markers are re-rendered (they are DOM elements, so they survive style changes automatically via Mapbox GL JS Markers API).

This prevents the route from disappearing after a style toggle — a common pitfall when using `map.setStyle()`.

---

## 8. API Routes

All routes live under `src/app/api/` and are Next.js App Router Route Handlers (serverless functions on Vercel).

| Route | Method | Description |
|-------|--------|-------------|
| `POST /api/analyze` | POST | Main entry-point. Accepts `{ url }`, runs scraper + location pipeline, returns a `RichPostData` + `LocationResult`. Validates that the URL is Instagram or TikTok before processing. |
| `POST /api/enhance` | POST | Accepts `{ name, city, country }`. Calls `enhanceSpotData()` (GPT-5 via GitHub Models, 12s timeout) to generate `description`, `category`, and `vibe`. Also fetches a Pexels photo for the spot. |
| `GET /api/search` | GET | Accepts `?q=<query>`. Proxies to Mapbox SearchBox v1 `suggest` endpoint. Used by the omni-search input for real-time place suggestions. |
| `POST /api/optimize` | POST | Accepts `{ coordinates: [lng, lat][] }`. Calls the Mapbox Optimization API v1 to compute the most efficient route order. Returns the optimized waypoint sequence + route geometry. |
| `GET /api/images` | GET | Accepts `?query=<text>`. Fetches a single photo from Pexels for a given search query. Falls back to a default travel image if `PEXELS_API_KEY` is not set. |
| `GET /api/proxy` | GET | Accepts `?url=<imageUrl>`. Server-side image proxy — fetches the remote image with a browser `User-Agent` and `Referer: https://www.instagram.com/` header, then streams it back to the client. Used to work around social CDN CORS restrictions. |
| `POST /api/telegram` | POST | Telegram bot webhook. Handles `/link <token>` command (links Telegram account to VOYGE user), and forwards pasted social media URLs through the full analyze pipeline, saving results directly to the user's Firestore spots collection. |

---

## 9. Key Thresholds & Tuning

These constants in `pipeline.ts` are the primary levers for tuning pipeline behaviour:

```typescript
// Minimum raw candidate confidence to even attempt geocoding.
// Candidates below this floor are skipped entirely (saves geocoder quota).
// Lowered from 0.80 → 0.55 to allow comment-derived candidates through.
const GEOCODE_CONFIDENCE_FLOOR = 0.55;

// Minimum final confidence to return a result from the geocode/verify pass
// without trying the AI agent. Below this, the AI agent is invoked.
const AI_AGENT_THRESHOLD = 0.60;

// Minimum final confidence to return ANY result at all (including from the
// AI agent). Results below this are discarded and null is returned.
const RETURN_THRESHOLD = 0.65;
```

### Effect of Threshold Changes

| Change | Effect |
|--------|--------|
| Lower `GEOCODE_CONFIDENCE_FLOOR` | More candidates geocoded → higher recall, more API calls |
| Raise `GEOCODE_CONFIDENCE_FLOOR` | Fewer candidates geocoded → faster, less accurate for noisy posts |
| Lower `AI_AGENT_THRESHOLD` | AI agent invoked more often → higher recall, higher cost + latency |
| Raise `AI_AGENT_THRESHOLD` | AI agent invoked less often → faster, misses hard cases |
| Lower `RETURN_THRESHOLD` | More results returned (lower quality) |
| Raise `RETURN_THRESHOLD` | Fewer results returned (higher quality) |

### AI Call Timeouts

In addition to the pipeline-level thresholds, individual AI calls have their own timeouts to prevent Vercel function timeouts:

| Call | Timeout |
|------|---------|
| `extractSpotData()` (full location pipeline via AI) | 25 seconds |
| `enhanceSpotData()` (description/category/vibe) | 12 seconds |
| AI agent global deadline | 45 seconds |
| Per-tool call inside AI agent | Inherits from underlying geocoder (typically 8–15s) |

---

*Last updated: VOYGE.studio v1.1.0*