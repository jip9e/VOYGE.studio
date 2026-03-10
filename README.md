<div align="center">

# ✈️ VOYGE.studio

[![Version](https://img.shields.io/badge/version-1.1.0-6366f1?style=flat-square)](https://github.com/jip9e/VOYGE.studio/releases)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38bdf8?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/license-Proprietary-red?style=flat-square)](./LICENSE)
[![Deployed on Vercel](https://img.shields.io/badge/Deployed_on-Vercel-black?style=flat-square&logo=vercel)](https://vercel.com)

**Turn your social media saves into optimized travel itineraries.**

*Paste a Reel or TikTok link. Watch the world map itself.*

[Features](#-features) · [How It Works](#-how-it-works) · [Quick Start](#-quick-start) · [API Reference](#-api-routes) · [Environment Variables](#-environment-variables) · [Contributing](#-contributing)

---

![VOYGE Dashboard Preview](./public/preview.jpg)

> *Dark globe · Satellite · Outdoors — three map styles, one intelligence engine.*

</div>

---

## 🧭 What is VOYGE.studio?

VOYGE.studio is a **travel intelligence platform** that bridges the gap between digital inspiration and real-world exploration. We all accumulate hundreds of bookmarked Reels and TikToks of hidden cafés, breathtaking viewpoints, and secret beaches — yet when it's actually time to travel, those saves stay buried in an endless scroll. VOYGE solves this by automatically extracting the real-world GPS location from any Instagram Reel or TikTok video using a proprietary **5-stage location extraction pipeline** — pulling signals from captions, hashtags, creator comments, anchor stickers, bios, thumbnails, and a final GPT-4o AI agent — then pinning each spot to an interactive 3D globe. From there, a mathematical route optimization engine based on the Travelling Salesman Problem eliminates zigzagging and turns your scattered saves into a logical, day-by-day itinerary. **No manual tagging. No copy-pasting addresses. Just paste a link.**

---

## ✨ Features

### 🔗 Universal Link Ingestion
- Paste any **Instagram Reel** or **TikTok** URL directly into the dashboard
- **Manual search** with real-time Mapbox SearchBox autocomplete for places not on social media
- **Telegram Bot** integration — forward any Reel or TikTok to `@Voygevercelbot` and it lands on your map automatically
- **iOS Shortcut** support for one-tap saving directly from the Apple Share Sheet

### 🧠 5-Stage Location Intelligence Engine
- **Stage 1 — Zero-compute extraction:** pulls ranked place-name candidates from captions, hashtags, geo-hashtags, creator replies, anchor/location stickers, bios, music titles, and tagged accounts — no API calls required
- **Stage 2 — Multi-API geocoding cascade:** tries up to 7 geocoding services (Mapbox → Nominatim → GeoNames → HERE → OpenCage → Overpass OSM) with confidence scoring per source
- **Stage 3 — Knowledge verification:** cross-references geocoded results against Wikipedia REST API and Google Knowledge Graph to weed out false positives
- **Stage 4 — Visual landmark detection:** runs Google Cloud Vision on the video thumbnail to detect famous landmarks directly from the image
- **Stage 5 — AI tool-calling agent:** GPT-4o agent with access to geocoding tools as a final authoritative fallback, with a 45-second deadline to prevent serverless timeouts

### 🗺️ Interactive 3D Globe
- **Mapbox GL JS v3** globe renderer with three switchable map styles: **Dark**, **Satellite**, and **Outdoors**
- Smooth **fly-to animations** when focusing on a saved spot
- **Glowing animated route paths** with multi-layer polyline rendering
- Route geometry persists across map style changes via `style.load` re-application
- Clustered marker system organized by **Country > City/Region**

### 📍 Smart Spot Management
- All spots stored in **Firebase Firestore**, scoped per authenticated user
- **Country emoji flags** (🇲🇦 🇮🇹 🇯🇵) with deep grouping by Country > City/Region
- **Category filtering** — Attractions, Museums, Food & Drink, Nature, Nightlife, and more
- **AI-enhanced metadata** — auto-generated descriptions, vibes, and category tags via GPT-4o
- **Pexels hero images** automatically fetched for every saved location
- Confidence score and source chain stored per spot for transparency

### 📐 Route Optimization
- Powered by the **Mapbox Optimization API** (Travelling Salesman Problem solver)
- Eliminates travel zigzagging across a multi-stop trip
- Visual path rendering on the globe with animated glow layers
- Optimized order displayed in the bottom sheet UI

---

## 🏗️ How It Works

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         USER INTERFACES                          │
│   Web Dashboard  ·  Telegram Bot  ·  iOS Shortcut                │
└────────────────────────────┬─────────────────────────────────────┘
                             │ URL / search query
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                      NEXT.JS API LAYER                           │
│  /api/analyze  /api/enhance  /api/search  /api/optimize          │
│  /api/images   /api/proxy    /api/telegram                       │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    ENGINE (engine.ts)                            │
│  processPost() — coordinates scraper + pipeline + enrichment     │
└──────┬───────────────────────────────────────────────┬──────────┘
       │                                               │
       ▼                                               ▼
┌─────────────────┐                       ┌───────────────────────┐
│  SCRAPER LAYER  │                       │   AI ENRICHMENT       │
│  scrapers.ts    │                       │   ai.ts               │
│                 │                       │                       │
│  Instagram:     │                       │  extractSpotData()    │
│  · api2 v1      │                       │  enhanceSpotData()    │
│  · api2 v1.1    │                       │  (GPT-4o, 25s / 12s) │
│  · instagram120 │                       └───────────────────────┘
│  · oEmbed       │
│                 │
│  TikTok:        │
│  · tikwm        │
│  · scraper7     │
└──────┬──────────┘
       │ RichPostData
       ▼
┌──────────────────────────────────────────────────────────────────┐
│               5-STAGE LOCATION PIPELINE (pipeline.ts)           │
│                                                                  │
│  Stage 1  extractor.ts   Zero-compute candidate extraction       │
│  Stage 2  geocoder.ts    7-service geocoding cascade             │
│  Stage 3  verifier.ts    Wikipedia + Knowledge Graph check       │
│  Stage 4  vision.ts      Google Vision landmark detection        │
│  Stage 5  ai-agent.ts    GPT-4o tool-calling agent               │
│                                                                  │
│  + LRU in-memory cache  +  Firestore cache (7-day TTL)          │
└──────────────────────────────────────────────────────────────────┘
       │ LocationResult { lat, lng, name, confidence, … }
       ▼
┌──────────────────────────────────────────────────────────────────┐
│                       FIREBASE FIRESTORE                         │
│  User spots collection — persisted, scoped per auth user         │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    MAPBOX GL JS v3 GLOBE                         │
│  MapComponent.tsx — styles, markers, routes, fog                 │
└──────────────────────────────────────────────────────────────────┘
```

### The 5-Stage Location Extraction Pipeline

When a link is submitted, `src/lib/location/pipeline.ts` orchestrates five stages sequentially, with parallel execution where safe and result caching throughout:

```
Social Media URL
       │
       ▼
[Scraper Layer] ── instagram-scraper-api2 / tiktok-scraper7 / tikwm
       │           Extracts: caption, hashtags, thumbnail, geo-data,
       │           creator comments, anchor locations, bio
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 1 · extractor.ts · Zero-Compute Signal Extraction        │
│                                                                  │
│  Signal sources (processed in priority order):                  │
│  · Native GPS coordinates (confidence floor: 1.00)             │
│  · Anchor / location stickers      (floor: 0.97)               │
│  · Pin emoji patterns              (floor: 0.95)               │
│  · Creator replies in comments     (floor: 0.90)               │
│  · Caption explicit place mentions (floor: 0.85)               │
│  · Geo-hashtags (#paris, #tokyo)   (floor: 0.80)               │
│  · Tagged accounts                 (floor: 0.75)               │
│  · Creator bio                     (floor: 0.70)               │
│  · Comment answer candidates       (floor: 0.65)               │
│  · Music title metadata            (floor: 0.60)               │
│                                                                  │
│  Bonus passes:                                                   │
│  · Comment vote triangulation (×1.15 for 2 votes, ×1.30 for 3+)│
│  · Geo-word vote pass (name appearing in ≥2 signal sources)     │
│                                                                  │
│  Output: ranked []CandidatePlace with confidence scores         │
└──────────────────────────────┬──────────────────────────────────┘
                               │ candidates[]
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 2 · geocoder.ts · Multi-API Geocoding Cascade            │
│                                                                  │
│  Tries each service in priority order until threshold met:      │
│  1. Mapbox SearchBox      (primary, highest accuracy)           │
│  2. Mapbox Geocoding V5                                         │
│  3. Nominatim (OpenStreetMap)                                   │
│  4. GeoNames (free tier)                                        │
│  5. HERE Geocoding API                                          │
│  6. OpenCage Geocoder                                           │
│  7. Overpass OSM (POI / natural feature fallback)               │
│                                                                  │
│  GEOCODE_CONFIDENCE_FLOOR = 0.55 (candidates below skip)        │
│  Country hinting from bio/caption boosts accuracy               │
│                                                                  │
│  Output: { lat, lng, placeName, confidence, source }            │
└──────────────────────────────┬──────────────────────────────────┘
                               │ geocoded result
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 3 · verifier.ts · Knowledge Verification                 │
│                                                                  │
│  Cross-references geocoded result against:                      │
│  · Wikipedia REST API (article existence + disambiguation)      │
│  · Google Knowledge Graph API (entity confidence scoring)       │
│                                                                  │
│  Boosts confidence for verified real-world places;              │
│  penalizes results with no knowledge base presence.             │
│                                                                  │
│  Output: verified result with adjusted confidence               │
└──────────────────────────────┬──────────────────────────────────┘
                               │ verified result
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 4 · vision.ts · Visual Landmark Detection                │
│  (runs in parallel with Stages 1–3)                             │
│                                                                  │
│  Sends video thumbnail to Google Cloud Vision API.              │
│  Landmark detection identifies famous places from image.        │
│  Returns name + GPS coordinates if a landmark is found.         │
│                                                                  │
│  Output: VisionResult { landmark, lat, lng } | null             │
└──────────────────────────────┬──────────────────────────────────┘
                               │ (override if high-confidence)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 5 · ai-agent.ts · GPT-4o Tool-Calling Agent              │
│  (invoked only if best pipeline result < AI_AGENT_THRESHOLD)    │
│                                                                  │
│  GitHub Models / Azure AI GPT-4o agent with tool access:        │
│  · geocode_place(query, countryHint)                            │
│  · verify_place(placeName, lat, lng)                            │
│  · search_knowledge_graph(query)                                │
│                                                                  │
│  Reasons over all signals — caption, hashtags, comments,        │
│  bio, anchor locations, composite hints — with explicit          │
│  labelling: LOCATION ANSWERS vs. LOCATION QUESTIONS.            │
│                                                                  │
│  45-second global deadline · MAX_ITERATIONS = 4                 │
│                                                                  │
│  Output: final { lat, lng, placeName, country, city }           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
                  RETURN_THRESHOLD = 0.65
                  Results below threshold are discarded.
                  Results above are saved to Firestore + Globe 🌍
```

---

## 🛠️ Tech Stack

| Category | Technology | Version | Purpose |
|---|---|---|---|
| **Frontend Framework** | Next.js App Router | 16.x | SSR, API routes, file-based routing |
| **Language** | TypeScript | 5.9 | Full type safety across the entire pipeline |
| **Styling** | Tailwind CSS | v4 | Utility-first dark-mode UI |
| **Animation** | Framer Motion | 12.x | iOS-style bottom sheet + gesture animations |
| **Auth & Database** | Firebase Auth + Firestore | 12.x | User accounts + spot persistence + pipeline cache |
| **Map Rendering** | Mapbox GL JS | v3 | 3D globe, clustering, route paths, style switching |
| **Geocoding (Primary)** | Mapbox SearchBox + V5 | — | Place search + reverse geocoding |
| **Geocoding (Fallbacks)** | Nominatim, GeoNames, HERE, OpenCage, Overpass | — | 7-service cascade fallback chain |
| **Scraping — Instagram** | RapidAPI `instagram-scraper-api2` + `instagram120` | — | Caption, hashtag, comments, bio, thumbnail |
| **Scraping — TikTok** | `tikwm` (primary) + RapidAPI `tiktok-scraper7` | — | Multi-layer TikTok data extraction |
| **AI Agent** | GitHub Models / Azure AI Inference (GPT-4o) | — | Stage 5 extraction + metadata enhancement |
| **Vision** | Google Cloud Vision API | — | Landmark detection on video thumbnails |
| **Verification** | Wikipedia REST API + Google Knowledge Graph | — | Confidence scoring for place names |
| **Images** | Pexels API | — | Hero images for saved spots |
| **Telegram** | Telegraf | v4 | Bot webhook for Reel/TikTok forwarding |
| **Route Optimization** | Mapbox Optimization API | — | TSP-based itinerary ordering |
| **Deployment** | Vercel | — | Serverless edge deployment |
| **HTTP Client** | Axios | 1.x | API requests throughout the pipeline |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 20.x
- **npm** ≥ 10.x
- A [Mapbox](https://account.mapbox.com/) account with a public access token
- A [Firebase](https://console.firebase.google.com/) project with Firestore and Authentication enabled
- A [RapidAPI](https://rapidapi.com/) account subscribed to at least the Instagram and TikTok scraper APIs
- A [GitHub Models](https://github.com/marketplace/models) token (or Azure AI Inference endpoint) for the AI agent

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/jip9e/VOYGE.studio.git
cd VOYGE.studio

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env.local
# Open .env.local and fill in your API keys — see the table below
```

### Start the development server

```bash
# With Turbopack (recommended — faster HMR)
npm run dev

# Without Turbopack (fallback if you hit bundler issues)
npm run dev:safe
```

The app will be available at `http://localhost:3000`.

### Production build

```bash
npm run build
npm start
```

### Lint check

```bash
npm run lint
```

---

## 🔑 Environment Variables

Copy `.env.example` to `.env.local` and fill in the values below. The file is listed in `.gitignore` and will never be committed.

### Required — core features will not function without these

| Variable | Description | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox public token — map rendering, geocoding, SearchBox, route optimization | [account.mapbox.com](https://account.mapbox.com/) |
| `RAPIDAPI_KEY` | Single key used for all RapidAPI-hosted scrapers (Instagram + TikTok) | [rapidapi.com](https://rapidapi.com/) |
| `GITHUB_MODELS_TOKEN` | GitHub Models / Azure AI token for GPT-4o (Stage 5 agent + spot enhancement) | [github.com/marketplace/models](https://github.com/marketplace/models) |

### Optional — features degrade gracefully when absent

| Variable | Description | Fallback behaviour | Where to get it |
|---|---|---|---|
| `GOOGLE_VISION_KEY` | Google Cloud Vision API key — landmark detection from thumbnails (Stage 4) | Vision stage is silently skipped | [console.cloud.google.com](https://console.cloud.google.com/apis/library/vision.googleapis.com) |
| `GOOGLE_KG_API_KEY` | Google Knowledge Graph API key — place entity verification (Stage 3) | KG verification is skipped; Wikipedia still runs | [console.cloud.google.com](https://console.cloud.google.com/apis/library/kgsearch.googleapis.com) |
| `GEONAMES_USERNAME` | GeoNames account username — geocoding cascade fallback (Stage 2) | That geocoder is skipped in the cascade | [geonames.org/login](https://www.geonames.org/login) — free signup |
| `HERE_API_KEY` | HERE Geocoding API key — geocoding cascade fallback (Stage 2) | That geocoder is skipped in the cascade | [developer.here.com](https://developer.here.com/) |
| `OPENCAGE_API_KEY` | OpenCage Geocoding API key — geocoding cascade fallback (Stage 2) | That geocoder is skipped in the cascade | [opencagedata.com](https://opencagedata.com/) |
| `PEXELS_API_KEY` | Pexels API key — high-quality hero images for saved spots | A default placeholder image is used | [pexels.com/api](https://www.pexels.com/api/) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token — forward Reels/TikToks to your map via chat | Bot integration is fully disabled | [@BotFather](https://t.me/BotFather) on Telegram |

### Firebase configuration

Firebase credentials are currently embedded in `src/lib/firebase.ts`. These are **client-side** Firebase Web SDK configuration values — they are designed to be public-facing and are secured by Firebase Security Rules on your project, not by keeping them secret. However, before open-sourcing the repository, consider moving them to `NEXT_PUBLIC_` prefixed environment variables for best practice.

> **Minimum viable setup:** You need `NEXT_PUBLIC_MAPBOX_TOKEN`, `RAPIDAPI_KEY`, and `GITHUB_MODELS_TOKEN` to use the core paste-a-link workflow end to end.

---

## 📁 Project Structure

```
VOYGE.studio/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Main dashboard UI (ZenDashboard component)
│   │   ├── layout.tsx                # Root layout — fonts, metadata, providers
│   │   ├── globals.css               # Global styles + Tailwind base layer
│   │   └── api/
│   │       ├── analyze/route.ts      # POST  — scrape URL + run 5-stage pipeline
│   │       ├── enhance/route.ts      # POST  — AI-enhance spot metadata via GPT-4o
│   │       ├── search/route.ts       # GET   — Mapbox place search suggestions
│   │       ├── optimize/route.ts     # POST  — Mapbox route optimization (TSP)
│   │       ├── images/route.ts       # GET   — Pexels image search for a place
│   │       ├── proxy/route.ts        # GET   — Image proxy (CORS bypass)
│   │       └── telegram/route.ts     # POST  — Telegram bot webhook handler
│   ├── components/
│   │   ├── MapComponent.tsx          # Mapbox GL JS globe — styles, markers, routes
│   │   └── BottomSheet.tsx           # iOS-style Framer Motion bottom drawer
│   └── lib/
│       ├── engine.ts                 # Main orchestrator: scrape → extract → geocode
│       ├── scrapers.ts               # Instagram + TikTok scrapers (multi-layer)
│       ├── ai.ts                     # GPT-4o extraction + spot enhancement helpers
│       ├── geo.ts                    # Legacy geocoding shim
│       ├── firebase.ts               # Firebase app + Firestore/Auth config
│       ├── optimize.ts               # Route optimization wrapper
│       ├── flags.ts                  # Country ISO → emoji flag mapping
│       ├── utils.ts                  # Tailwind class merge utility (cn)
│       └── location/
│           ├── index.ts              # Public re-exports for the location module
│           ├── pipeline.ts           # 5-stage orchestration + confidence math + cache
│           ├── extractor.ts          # Stage 1: zero-compute signal extraction
│           ├── geocoder.ts           # Stage 2: 7-service geocoding cascade
│           ├── verifier.ts           # Stage 3: Wikipedia + Knowledge Graph verification
│           ├── vision.ts             # Stage 4: Google Cloud Vision landmark detection
│           └── ai-agent.ts           # Stage 5: GPT-4o tool-calling agent
├── scripts/
│   └── diagnose-tiktok.mjs           # CLI diagnostic tool for TikTok scraper debugging
├── public/
│   └── preview.jpg                   # Dashboard preview screenshot
├── .env.example                      # Environment variable template (commit this)
├── .env.local                        # Your actual secrets (gitignored)
├── next.config.ts                    # Next.js configuration
├── tsconfig.json                     # TypeScript configuration
└── package.json
```

---

## 🔌 API Routes

All routes live under `src/app/api/` as Next.js App Router handlers.

### `POST /api/analyze`

Scrapes a social media URL and runs the full 5-stage location extraction pipeline.

**Request:**
```json
{
  "url": "https://www.instagram.com/reel/ABC123/"
}
```

**Response:**
```json
{
  "success": true,
  "travel_spots": [
    {
      "name": "Jardin Majorelle",
      "city": "Marrakech",
      "country": "Morocco",
      "category": "Attraction",
      "vibe": "Lush botanical garden with vivid cobalt blue architecture",
      "description": "A stunning 12-acre garden designed by Jacques Majorelle...",
      "confidence": 0.94,
      "coordinates": { "lat": 31.6396, "lng": -8.0 },
      "full_address": "Rue Yves Saint Laurent, Marrakech 40090, Morocco",
      "original_link": "https://www.instagram.com/reel/ABC123/",
      "geo_source": "mapbox_searchbox"
    }
  ],
  "thumbnail": "https://...",
  "original_link": "https://www.instagram.com/reel/ABC123/"
}
```

---

### `POST /api/enhance`

Uses GPT-4o to generate a description, category, and vibes string for a given spot name.

**Request:**
```json
{
  "placeName": "Jardin Majorelle, Marrakech"
}
```

**Response:**
```json
{
  "category": "Attraction",
  "vibe": "Botanical escape with iconic electric-blue architecture",
  "description": "A serene 12-acre garden retreat in the heart of Marrakech..."
}
```

---

### `GET /api/search?q={query}`

Proxies a Mapbox SearchBox query and returns autocomplete place suggestions for the search UI.

**Response:** Array of Mapbox SearchBox suggestion objects.

---

### `POST /api/optimize`

Accepts an ordered array of spot coordinates and returns the mathematically optimized visit order using the Mapbox Optimization API (TSP solver).

**Request:**
```json
{
  "spots": [
    { "lat": 31.6396, "lng": -8.0 },
    { "lat": 31.6295, "lng": -7.9811 },
    { "lat": 31.6258, "lng": -7.9891 }
  ]
}
```

**Response:** Optimized coordinate sequence + Mapbox route geometry for rendering.

---

### `GET /api/images?q={query}`

Searches Pexels for high-quality travel photos matching a place name. Returns the top result URL.

---

### `GET /api/proxy?url={imageUrl}`

Proxies an external image URL through the Next.js backend to bypass browser CORS restrictions when rendering thumbnails from social media CDNs.

---

### `POST /api/telegram`

Telegram bot webhook endpoint. Receives messages forwarded to the bot, extracts any social media links, triggers the full analyze pipeline, and saves the resulting spot(s) to the sender's Firestore document. Replies with the detected location name and coordinates.

---

## 🤖 Telegram Bot Setup

Forward any Instagram Reel or TikTok to your Telegram bot and it will automatically pin the location to your VOYGE map.

**1. Create a bot via [@BotFather](https://t.me/BotFather)**

```
/newbot
→ Choose a name: VOYGE
→ Choose a username: YourVoygeBot
→ Copy the token that BotFather gives you
```

**2. Add the token to `.env.local`**

```
TELEGRAM_BOT_TOKEN=your_token_here
```

**3. Register the webhook** after deploying to Vercel

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-app.vercel.app/api/telegram"}'
```

**4. Use it** — forward any Instagram Reel or TikTok video to your bot. VOYGE will extract the location, save the spot, and reply with the result.

> **Note:** The Telegram webhook requires HTTPS. Vercel deployments satisfy this automatically. For local development, use [ngrok](https://ngrok.com/) to expose your localhost.

---

## 📱 iOS Shortcut

An iOS Shortcut lets you share any Reel or TikTok from the native Share Sheet to your VOYGE map in a single tap. The shortcut calls `POST /api/analyze` with the shared URL. Full setup instructions are available in the [project wiki](../../wiki).

---

## 🧪 Diagnostics

A CLI diagnostic script is included for debugging TikTok scraper issues without starting the dev server:

```bash
node scripts/diagnose-tiktok.mjs <tiktok_url>
```

**Example:**

```bash
node scripts/diagnose-tiktok.mjs "https://www.tiktok.com/@user/video/1234567890"
```

The script:
1. Loads `.env.local` automatically (no separate `dotenv` install required)
2. Calls each TikTok scraping backend in sequence (`tikwm`, `tiktok-scraper7`)
3. Pretty-prints the raw response from each layer
4. Shows exactly which fields were populated — making it easy to spot which scraper is returning usable location data and which is failing

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide, including project structure, code style, commit format, and the PR process.

**Quick steps:**

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes (TypeScript + Tailwind conventions, no plain JS in `src/`)
4. Run `npm run lint && npm run build` — both must pass
5. Open a pull request with a clear description of the change

Bug reports and feature requests are tracked via [GitHub Issues](../../issues).

---

## 📄 License

Copyright © 2026 VOYGE.studio. All rights reserved.

This software is proprietary. No part of this codebase may be reproduced, distributed, modified, or used in derivative works without explicit written permission from the copyright holder.

See [LICENSE](./LICENSE) for the full license text.

---

<div align="center">

Built with obsession by **VOYGE.studio** ✈️

*Your social media saves, mathematically perfected.*

</div>