# Changelog

All notable changes to VOYGE.studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [1.1.0] - 2025

> **The robustness update.** Instagram scraper parity with TikTok, a hardened location extraction pipeline, tighter AI budgets, derived-location poisoning fixes, and a map style switcher.

### Added

#### Instagram Scraper (`scrapers.ts`)

- **Multi-layer fallback chain** mirroring the TikTok scraper architecture: `instagram-scraper-api2` (v1) → `instagram-scraper-api2` (v1.1) → `instagram120` → oEmbed. Instagram scraping no longer fails silently when the primary RapidAPI endpoint is unavailable.
- **Creator comment extraction** (`extractCreatorComments`): identifies comments posted by the creator's own account (matched against `unique_id`, `uniqueId`, and `nickname` fields) and surfaces them as `_creatorComments` — the same high-trust signal already used in the TikTok pipeline.
- **Anchor location extraction** from Instagram video metadata, exposed as `_anchorLocations` in the `RichPostData` object.
- **Composite hints** (`_compositeHints`): region + environment type combinations (e.g. `"river in Oregon"`) pre-built by `buildCompositeHints()` and passed directly to the AI agent as structured context.
- **Reply expansion**: top-level comments with replies are now expanded (up to 5 threads), and creator replies within those expanded threads are identified and added to `_creatorComments`.
- **Profile pass**: creator bio is now fetched separately via a profile endpoint and surfaced as `user_bio` for Instagram posts, matching the field already available from TikTok metadata.

#### Extractor (`location/extractor.ts`)

- **`comment_answer` candidate extraction**: non-creator comments that contain known geo-words and match `LOCATION_ANSWER_PATTERNS` are now extracted as geocoding candidates with a confidence floor of `0.65`.
- **Comment vote triangulation pass**: place names mentioned in ≥ 2 independent comments receive a confidence boost — ×1.15 for 2 votes, ×1.30 for 3 or more votes.
- **Geo-word vote pass**: a final scan across all text fields promotes place names that appear in ≥ 2 distinct signal sources.
- **Improved `extractPlaceFromText` regexes**: new patterns for `"This is …"`, `"it's [Place]"`, `"located in …"`, `"in/at [Place]"`, and title-case multi-word place names. Patterns are more specific and sentence-boundary-aware to reduce false positives.
- **`GENERIC_WORDS` blocklist expanded** (~110 entries) covering additional generic travel and nature vocabulary (e.g. `"hidden gem"`, `"stunning"`, `"magical"`, `"paradise"`) that should never be surfaced as a place name candidate.

#### Pipeline (`location/pipeline.ts`)

- **`GEOCODE_CONFIDENCE_FLOOR` lowered from `0.80` → `0.55`**: comment-derived and bio-derived candidates now pass through to the geocoder, significantly improving recall for posts with no explicit location tag or geo-hashtag.

#### AI Agent (`location/ai-agent.ts`)

- **45-second global deadline** (`agentDeadline = Date.now() + 45_000`): the agentic loop now hard-stops before Vercel's serverless function timeout, returning the best partial result rather than timing out the entire request.
- **`MAX_ITERATIONS` reduced from `5` → `4`**: tighter token and time budget with no meaningful accuracy loss in testing.
- **Improved signal context** (`buildSignalContext`): comments are now split into three clearly labelled buckets — `LOCATION-RELEVANT COMMENTS` (answers to "where is this?"), `LOCATION QUESTIONS` (explicitly flagged as NOT location evidence), and neutral comments. This prevents the model from treating viewer questions (`"Where is this??"`, `"What's the location?"`) as positive location evidence.
- **Per-tool timeouts** in `executeTool()`: each tool call now wraps its underlying geocoding or verification call in its own `AbortController` with a timeout, preventing a single slow API from stalling the entire agent loop.

#### AI Calls (`ai.ts`)

- **25-second timeout on `extractSpotData()`** to prevent Vercel serverless function timeouts on slow GitHub Models / Azure AI Inference responses.
- **12-second timeout on `enhanceSpotData()`** for the same reason.

#### Map (`components/MapComponent.tsx` + `app/page.tsx`)

- **Style switcher UI**: users can now toggle between three Mapbox base styles — **Dark** (`mapbox://styles/mapbox/dark-v11`), **Satellite** (`mapbox://styles/mapbox/satellite-streets-v12`), and **Outdoors** (`mapbox://styles/mapbox/outdoors-v12`) — via a control in the map interface.
- **Fog configuration per style**: atmospheric fog colour is adjusted to complement each style — deep navy for Dark, atmospheric haze for Satellite, pale sky for Outdoors.
- **Route persistence across style changes**: the map now listens for `style.load` and re-applies the optimized route GeoJSON source, the route line layer, and the animated glow layers after every style switch so the path is never lost when the user toggles styles.

### Fixed

- **Derived-location poisoning**: raw comment text is now sanitised before being used as `location_name`. Text that contains only generic words (e.g. `"What a beautiful place!"`, `"Hidden gem 🌊"`) without a proper noun is rejected outright. Candidates derived from comment text are capped at a maximum confidence of `0.65` regardless of vote count.
- **Location question misclassification**: viewer comments asking where a place is (e.g. `"Where is this??"`, `"What's the location?"`, `"Anyone know the name?"`) were previously being forwarded to the AI agent as positive location evidence. They are now identified via `LOCATION_QUESTION_PATTERNS` and explicitly labelled as questions — not answers — in the AI signal context.
- **AI agent stalling**: the absence of per-tool timeouts could cause the agent loop to hang indefinitely if a geocoder or verifier API was slow or unresponsive. Each tool call now has its own abort controller with an independent timeout.
- **Route disappearing on map style change**: switching the Mapbox base style removed all dynamically added GeoJSON sources and layers. The optimized route is now re-applied inside a `style.load` event handler so it persists across every style switch.

### Changed

- `SOURCE_CONFIDENCE_FLOORS` table updated:
  - `native_gps` raised to `1.0` (was `0.98`)
  - `anchor_location` raised to `0.97` (was `0.90`)
  - `pin_emoji` raised to `0.95` (was `0.85`)
- `AI_AGENT_THRESHOLD` remains `0.60` (unchanged).
- `RETURN_THRESHOLD` remains `0.65` (unchanged).

---

## [1.0.0] - 2025

> **Initial release.** The complete VOYGE.studio platform — a travel intelligence app that turns Instagram Reels and TikToks into an optimized 3D globe itinerary.

### Added

#### Location Extraction Pipeline

- **Five-stage location extraction pipeline**: zero-compute text extractor → multi-API geocoder cascade → Wikipedia + Knowledge Graph verification → Google Vision landmark detection → GPT-5 tool-calling AI agent.
- **Geocoder cascade** (Stage 2): Mapbox SearchBox → Mapbox Geocoding V5 → Nominatim (OpenStreetMap) → GeoNames → HERE → OpenCage → Overpass OSM. Seven services tried in priority order until a confidence threshold is reached.
- **`SOURCE_CONFIDENCE_FLOORS`** table: per-signal-type confidence starting floors used in candidate scoring (native GPS, anchor location, pin emoji, creator reply, caption explicit, geo-hashtag, tagged account, bio-based, comment answer, music title).
- **Two-layer result cache**: LRU in-memory cache for within-session performance + Firebase Firestore cache with a 7-day TTL for cross-session persistence, keyed by URL.
- **TikTok scraper** (`scrapers.ts`): `tikwm.com` as the primary scraper with `tiktok-scraper7` RapidAPI as a fallback layer.
- **Instagram scraper** (`scrapers.ts`): `instagram-scraper-api2` (RapidAPI) as the primary scraper.

#### Intelligence & AI

- **Link & Omni-Search**: paste any Instagram Reel or TikTok URL directly into the dashboard, or search for a place name using Mapbox SearchBox real-time autocomplete.
- **AI Enhancement** (`ai.ts`): `enhanceSpotData()` automatically generates a description, category classification, and vibes string for every spot using GPT-5 via GitHub Models / Azure AI Inference.
- **`extractSpotData()`**: structured JSON extraction of spot metadata (name, city, country, category, vibe, description) from raw scraper data using GPT-5 function calling.

#### Visual Content Engine

- **Pexels API integration** (`api/images/route.ts`): high-quality travel photos automatically fetched for every saved location using the place name as a search query.
- **Image proxy** (`api/proxy/route.ts`): server-side proxy for external image URLs to bypass browser CORS restrictions when rendering social media thumbnails.

#### Map & UI

- **Mapbox GL JS v3 globe** (`MapComponent.tsx`): interactive 3D globe in dark mode with smooth fly-to animations, clustered spot markers, and animated glowing route polylines.
- **Route optimization** (`api/optimize/route.ts`, `optimize.ts`): Mapbox Optimization API wrapper implementing a Travelling Salesman Problem solver to eliminate travel zigzagging across a multi-stop trip.
- **iOS-style Bottom Sheet** (`BottomSheet.tsx`): high-fidelity Framer Motion-powered bottom drawer for mobile, mimicking native iOS gesture physics — drag, snap, expand, collapse.
- **Desktop Drawer**: the bottom sheet logic is translated into a side drawer layout for desktop users, keeping the interaction model consistent across screen sizes.
- **Category chips**: filter bar at the top of the bottom sheet for instant filtering by Attractions, Museums, Food & Drink, Nature, Nightlife, and more.
- **Deep grouping**: saved spots organized by Country > City/Region with collapsible city headers showing spot counts (e.g. `"Rome (14)"`).
- **Country emoji flags** (`flags.ts`): ISO 3166-1 alpha-2 country codes automatically mapped to their respective emoji flags (🇲🇦 🇮🇹 🇯🇵) and displayed on group headers.

#### Ecosystem Integrations

- **Telegram Bot** (`api/telegram/route.ts`): Telegraf v4 webhook handler — forward any Instagram Reel or TikTok to `@Voygevercelbot` and VOYGE automatically extracts the location, saves it to Firestore, and replies with the result.
- **iOS Shortcut**: `POST /api/analyze` endpoint designed to accept requests from an iOS Shortcut triggered from the native Share Sheet.

#### Infrastructure

- **Next.js 16 App Router** with Vercel Serverless Functions for all API routes.
- **Firebase Firestore + Firebase Auth** for spot persistence and user authentication, scoped per authenticated user.
- **Mapbox GL JS v3** with SearchBox API and Optimization API.
- **GitHub Models (GPT-5)** via `@azure-rest/ai-inference` for AI intelligence throughout the pipeline.
- **TypeScript 5.9** with strict mode across the entire codebase.
- **Tailwind CSS v4** for utility-first styling.
- **Framer Motion 12** for gesture-driven animations.
- **`diagnose-tiktok.mjs`** script (`scripts/`): CLI diagnostic tool that dumps raw API responses from each TikTok scraping backend for debugging without starting the dev server.

---

[Unreleased]: https://github.com/jip9e/VOYGE.studio/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/jip9e/VOYGE.studio/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/jip9e/VOYGE.studio/releases/tag/v1.0.0