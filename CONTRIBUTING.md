# Contributing to VOYGE.studio

Thank you for your interest in contributing to VOYGE.studio! This guide covers everything you need to get the project running locally, understand the codebase, and submit quality pull requests.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Fork & Clone](#2-fork--clone)
3. [Environment Variable Setup](#3-environment-variable-setup)
4. [Development Workflow](#4-development-workflow)
5. [Project Structure](#5-project-structure)
6. [How the Location Pipeline Works](#6-how-the-location-pipeline-works)
7. [Code Style Guidelines](#7-code-style-guidelines)
8. [Commit Message Format](#8-commit-message-format)
9. [Testing & Diagnostics](#9-testing--diagnostics)
10. [Pull Request Process](#10-pull-request-process)
11. [Security](#11-security)
12. [Reporting Issues](#12-reporting-issues)

---

## 1. Prerequisites

Before you begin, make sure you have the following installed:

| Tool | Minimum version | Notes |
|------|----------------|-------|
| **Node.js** | 20.x | Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to manage versions |
| **npm** | 10.x | Comes bundled with Node 20 |
| **Git** | any recent | — |
| **VS Code** (recommended) | — | TypeScript IntelliSense + ESLint integration |

You will also need accounts/tokens for at minimum:

- **Mapbox** — [account.mapbox.com](https://account.mapbox.com/) — for map rendering and geocoding
- **RapidAPI** — [rapidapi.com](https://rapidapi.com/) — subscribed to `instagram-scraper-api2` and `tiktok-scraper7`
- **GitHub Models** — [github.com/marketplace/models](https://github.com/marketplace/models) — for the GPT-4o AI agent

See [Section 3](#3-environment-variable-setup) for the full list of optional keys.

---

## 2. Fork & Clone

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/<your-username>/VOYGE.studio.git
cd VOYGE.studio

# 2. Add the upstream remote so you can pull future changes
git remote add upstream https://github.com/jip9e/VOYGE.studio.git

# 3. Install dependencies
npm install
```

---

## 3. Environment Variable Setup

Copy the example environment file and fill in your keys:

```bash
cp .env.example .env.local
```

Then open `.env.local` in your editor. The table below documents every variable:

### Required — the core paste-a-link workflow will not work without these

| Variable | Description | Where to get it |
|----------|-------------|----------------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox public token — map rendering, SearchBox autocomplete, geocoding, route optimization | [account.mapbox.com](https://account.mapbox.com/) |
| `RAPIDAPI_KEY` | Single key for all RapidAPI-hosted scrapers (Instagram + TikTok) | [rapidapi.com](https://rapidapi.com/) |
| `GITHUB_MODELS_TOKEN` | GitHub Models / Azure AI token — GPT-4o for Stage 5 agent and spot enhancement | [github.com/marketplace/models](https://github.com/marketplace/models) |

### Optional — features degrade gracefully without these

| Variable | Description | Fallback behaviour | Where to get it |
|----------|-------------|-------------------|----------------|
| `GOOGLE_VISION_KEY` | Google Cloud Vision API — landmark detection on thumbnails (Stage 4) | Vision stage is silently skipped | [console.cloud.google.com](https://console.cloud.google.com/apis/library/vision.googleapis.com) |
| `GOOGLE_KG_API_KEY` | Google Knowledge Graph API — place entity verification (Stage 3) | KG verification is skipped; Wikipedia still runs | [console.cloud.google.com](https://console.cloud.google.com/apis/library/kgsearch.googleapis.com) |
| `GEONAMES_USERNAME` | GeoNames account username — geocoding cascade fallback | That geocoder is skipped in the cascade | [geonames.org/login](https://www.geonames.org/login) — free signup |
| `HERE_API_KEY` | HERE Geocoding API — geocoding cascade fallback | That geocoder is skipped in the cascade | [developer.here.com](https://developer.here.com/) |
| `OPENCAGE_API_KEY` | OpenCage Geocoding API — geocoding cascade fallback | That geocoder is skipped in the cascade | [opencagedata.com](https://opencagedata.com/) |
| `PEXELS_API_KEY` | Pexels API — hero images for saved spots | A default placeholder image is shown | [pexels.com/api](https://www.pexels.com/api/) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token — forward Reels/TikToks to your map | Bot integration is fully disabled | [@BotFather](https://t.me/BotFather) on Telegram |

> **Minimum viable setup:** `NEXT_PUBLIC_MAPBOX_TOKEN` + `RAPIDAPI_KEY` + `GITHUB_MODELS_TOKEN` covers the entire core workflow.

---

## 4. Development Workflow

### Start the dev server

```bash
# Recommended — uses Turbopack for fast HMR
npm run dev

# Fallback — disable Turbopack if you hit bundler issues
npm run dev:safe
```

The app is available at [http://localhost:3000](http://localhost:3000).

### Before opening a PR

```bash
# Both must pass cleanly
npm run lint
npm run build
```

### Branching strategy

Branch off `main` for all changes. Use a descriptive prefix:

| Prefix | When to use |
|--------|-------------|
| `feat/` | New feature or capability |
| `fix/` | Bug fix |
| `refactor/` | Code restructuring without behaviour change |
| `docs/` | Documentation only |
| `chore/` | Tooling, deps, CI |
| `perf/` | Performance improvement |

**Examples:**
```
feat/instagram-fallback-v2
fix/geocoder-confidence-floor
docs/architecture-update
refactor/extractor-vote-pass
perf/pipeline-parallel-geocode
```

### Typical change lifecycle

```bash
# Create your branch
git checkout -b feat/your-feature

# Make changes, verify frequently
npm run lint
npm run build

# Commit (see Section 8 for message format)
git add .
git commit -m "feat(extractor): add comment vote triangulation pass"

# Keep your branch up to date with upstream
git fetch upstream
git rebase upstream/main

# Push and open a PR
git push origin feat/your-feature
```

---

## 5. Project Structure

```
VOYGE.studio/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── page.tsx                  # Main dashboard — ZenDashboard component
│   │   ├── layout.tsx                # Root layout, fonts, metadata, providers
│   │   ├── globals.css               # Global styles + Tailwind base layer
│   │   └── api/                      # Serverless API route handlers
│   │       ├── analyze/route.ts      # POST — scrape URL + run 5-stage pipeline
│   │       ├── enhance/route.ts      # POST — AI-enhance spot metadata via GPT-4o
│   │       ├── search/route.ts       # GET  — Mapbox SearchBox autocomplete proxy
│   │       ├── optimize/route.ts     # POST — Mapbox TSP route optimization
│   │       ├── images/route.ts       # GET  — Pexels image search for a place name
│   │       ├── proxy/route.ts        # GET  — Image proxy for CORS bypass
│   │       └── telegram/route.ts     # POST — Telegram bot webhook handler
│   │
│   ├── components/
│   │   ├── MapComponent.tsx          # Mapbox GL JS globe — styles, markers,
│   │   │                             #   routes, fog, style switcher
│   │   └── BottomSheet.tsx           # iOS-style Framer Motion bottom drawer
│   │                                 #   (mobile) + Drawer (desktop)
│   │
│   └── lib/
│       ├── engine.ts                 # processPost() — coordinates scraper,
│       │                             #   pipeline, enrichment, Firestore cache
│       ├── scrapers.ts               # Instagram + TikTok multi-layer scrapers,
│       │                             #   creator comment extraction, anchor locs
│       ├── ai.ts                     # extractSpotData() + enhanceSpotData()
│       │                             #   (GPT-4o, 25s / 12s timeouts)
│       ├── geo.ts                    # Legacy geocoding shim
│       ├── firebase.ts               # Firebase app init, Auth, Firestore
│       ├── optimize.ts               # Mapbox Optimization API wrapper
│       ├── flags.ts                  # Country ISO code → emoji flag mapping
│       ├── utils.ts                  # cn() Tailwind class merge utility
│       └── location/                 # ★ The 5-stage location pipeline
│           ├── index.ts              # Public re-exports (import from here)
│           ├── pipeline.ts           # Orchestration, confidence math,
│           │                         #   LRU cache + Firestore cache
│           ├── extractor.ts          # Stage 1: zero-compute signal extraction
│           ├── geocoder.ts           # Stage 2: 7-service geocoding cascade
│           ├── verifier.ts           # Stage 3: Wikipedia + Knowledge Graph
│           ├── vision.ts             # Stage 4: Google Vision landmark detection
│           └── ai-agent.ts           # Stage 5: GPT-4o tool-calling agent
│
├── scripts/
│   └── diagnose-tiktok.mjs           # CLI tool — raw scraper response dump
│
├── public/
│   └── preview.jpg                   # Dashboard screenshot (used in README)
│
├── .env.example                      # Variable template — commit this
├── .env.local                        # Your actual secrets — never commit this
├── next.config.ts                    # Next.js config
├── tsconfig.json                     # TypeScript config
└── package.json
```

### Key entry points

| You want to… | Start here |
|---|---|
| Change what data is scraped from Instagram/TikTok | `src/lib/scrapers.ts` |
| Change how place-name candidates are extracted from text | `src/lib/location/extractor.ts` |
| Add or reorder geocoding services | `src/lib/location/geocoder.ts` |
| Tune confidence thresholds | `src/lib/location/pipeline.ts` (top constants) |
| Change how the AI agent reasons about location | `src/lib/location/ai-agent.ts` |
| Change map styles or route rendering | `src/components/MapComponent.tsx` |
| Add a new API endpoint | `src/app/api/<name>/route.ts` |

---

## 6. How the Location Pipeline Works

Understanding the location pipeline is **essential** before touching anything under `src/lib/location/`. Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the complete technical reference. Here is a quick summary.

When a user pastes a URL, the flow is:

```
URL
 └─► engine.ts (processPost)
       ├─► scrapers.ts          — fetch RichPostData from Instagram or TikTok
       └─► pipeline.ts (extractLocation)
             ├─► Stage 1: extractor.ts     — zero-compute candidate extraction
             ├─► Stage 2: geocoder.ts      — 7-service geocoding cascade
             ├─► Stage 3: verifier.ts      — Wikipedia + KG verification
             ├─► Stage 4: vision.ts        — Google Vision landmark detection
             └─► Stage 5: ai-agent.ts      — GPT-4o tool-calling fallback
```

### Key constants in `pipeline.ts`

```typescript
const GEOCODE_CONFIDENCE_FLOOR = 0.55; // candidates below this skip the geocoder
const AI_AGENT_THRESHOLD       = 0.60; // invoke AI agent if best result < this
const RETURN_THRESHOLD         = 0.65; // discard final result if confidence < this
```

Changing these values has significant effects on **accuracy**, **API cost**, and **speed**. See [`ARCHITECTURE.md § Key Thresholds & Tuning`](./ARCHITECTURE.md#9-key-thresholds--tuning) before modifying them.

### Source confidence floors

Each signal source in Stage 1 has a minimum confidence floor that determines whether it is forwarded to the geocoder:

| Source type | Floor |
|---|---|
| `native_gps` | 1.00 |
| `anchor_location` | 0.97 |
| `pin_emoji` | 0.95 |
| `creator_reply` | 0.90 |
| `caption_explicit` | 0.85 |
| `geo_hashtag` | 0.80 |
| `tagged_account` | 0.75 |
| `bio_based` | 0.70 |
| `comment_answer` | 0.65 |
| `music_title` | 0.60 |

### Adding a new geocoder

If you add a new geocoding service to `geocoder.ts`:

1. Add it to the `geocoders` array in `geocodePlace()` at the correct priority position.
2. Add a multiplier entry to `geocoderMultiplier()` in `pipeline.ts`.
3. Add the geocoder's environment variable to `.env.example` (if it requires a key).
4. Document it in the geocoder cascade table in `ARCHITECTURE.md`.
5. Test with at least three different place types: a major city, a natural feature, and a neighbourhood.

---

## 7. Code Style Guidelines

### TypeScript

- **All new files must be TypeScript** (`.ts` or `.tsx`). No plain JavaScript under `src/`.
- Prefer explicit return types on exported functions.
- Use `interface` for object shapes; use `type` for unions and aliases.
- Avoid `any` — use `unknown` with type narrowing when the shape is truly dynamic.
- Async functions that can fail should return `T | null` rather than throwing, unless the error must propagate to the user.

### React / Next.js App Router

- All pages and layouts live under `src/app/` following App Router conventions.
- Components are **Server Components by default**. Only add `"use client"` when you need browser APIs, React state, or effects.
- Route handlers live in `src/app/api/<name>/route.ts` and must export named HTTP method functions (`GET`, `POST`, etc.).
- Do not use the Pages Router (`pages/` directory).
- Keep API route handlers thin — business logic belongs in `src/lib/`, not in `route.ts` files.

### Tailwind CSS

- Use Tailwind utility classes for all styling. Avoid custom CSS unless absolutely necessary.
- Keep long `className` strings readable — break them across lines when they exceed ~80 characters.
- Follow the existing **dark-mode-first** design convention.

### Mapbox GL JS

- All map interactions go through the `mapboxgl` import from `mapbox-gl`.
- Always re-apply custom sources and layers inside a `map.on("style.load", ...)` handler — style changes remove all dynamically added layers.
- Use Mapbox GL JS Markers (DOM-based) for spot pins so they survive style changes without being re-added.

### Logging

- Do not leave bare `console.log` calls in production paths.
- Use a `[Module]` prefix so server logs are grep-able:
  ```
  [Pipeline]   candidate "Jardin Majorelle" → confidence 0.94
  [Geocoder]   Mapbox SearchBox hit for "Jardin Majorelle, Marrakech"
  [Vision]     Landmark detected: Eiffel Tower (0.991)
  [AIAgent]    Tool call: geocode_place("blue lake", "NZ")
  ```
- Accepted module prefixes: `[Pipeline]`, `[Geocoder]`, `[Verifier]`, `[Vision]`, `[AIAgent]`, `[Scraper]`, `[Engine]`, `[Telegram]`.

### Documentation

- When adding a new geocoder or signal source, update `ARCHITECTURE.md`.
- When adding or changing an environment variable, update `.env.example`.
- When making a notable change, add an entry to `CHANGELOG.md`.

---

## 8. Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description in imperative mood>

[optional longer body]

[optional footer — e.g. "Closes #42"]
```

### Types

| Type | When to use |
|---|---|
| `feat` | New feature or behaviour |
| `fix` | Bug fix |
| `refactor` | Restructuring without behaviour change |
| `perf` | Performance improvement |
| `docs` | Documentation only |
| `chore` | Build tooling, deps, CI, config |
| `test` | Adding or fixing tests |

### Scopes

| Scope | File(s) |
|---|---|
| `extractor` | `location/extractor.ts` |
| `geocoder` | `location/geocoder.ts` |
| `verifier` | `location/verifier.ts` |
| `vision` | `location/vision.ts` |
| `ai-agent` | `location/ai-agent.ts` |
| `pipeline` | `location/pipeline.ts` |
| `scraper` | `scrapers.ts` |
| `engine` | `engine.ts` |
| `map` | `MapComponent.tsx` |
| `api` | `src/app/api/**` |
| `ui` | `src/components/**`, `src/app/page.tsx` |
| `deps` | `package.json` |

### Examples

```
feat(geocoder): add Overpass OSM fallback for natural features
fix(extractor): prevent generic words from poisoning derived locations
perf(pipeline): lower GEOCODE_CONFIDENCE_FLOOR to 0.55
docs(architecture): document confidence scoring formula
chore(deps): bump mapbox-gl to 3.18.1
refactor(scraper): unify Instagram fallback chain with TikTok pattern
```

---

## 9. Testing & Diagnostics

VOYGE.studio does not yet have a formal automated test suite. Use the diagnostic tooling and manual verification steps below until one is added.

### `diagnose-tiktok.mjs` — TikTok scraper diagnostics

The project ships a CLI script that dumps raw API responses from the TikTok scraping layers. This is the fastest way to debug a broken TikTok URL without starting the full dev server.

```bash
node scripts/diagnose-tiktok.mjs <tiktok_url>
```

**Example:**

```bash
node scripts/diagnose-tiktok.mjs "https://www.tiktok.com/@user/video/1234567890"
```

The script:

1. Loads `.env.local` manually — no separate `dotenv` installation needed.
2. Calls each scraping backend in sequence (`tikwm`, then `tiktok-scraper7`).
3. Pretty-prints the full raw response from each layer.
4. Shows exactly which fields were populated, making it easy to see which scraper is returning usable location data.

### Manual end-to-end testing

1. Start the dev server: `npm run dev`
2. Paste a TikTok or Instagram URL into the search bar.
3. Watch the terminal — each pipeline stage logs its result with a `[Stage]` prefix.
4. Verify the map pin lands in the correct location.
5. Check the confidence label shown on the saved spot card.

### Filtering server logs by stage

Server logs are structured for easy filtering. For example, to watch only geocoder activity:

```bash
# Unix / macOS / WSL
npm run dev 2>&1 | grep "\[Geocoder\]"

# Full pipeline trace
npm run dev 2>&1 | grep -E "\[(Pipeline|Geocoder|Verifier|Vision|AIAgent)\]"
```

On Windows PowerShell:

```powershell
npm run dev | Select-String -Pattern "\[Geocoder\]"
```

---

## 10. Pull Request Process

1. **One concern per PR.** A PR that fixes a bug and adds a feature is harder to review and harder to revert. Split them up.

2. **Fill in the PR description** template. At minimum, explain:
   - What problem does this solve, or what feature does it add?
   - How did you test it (manual steps + any URLs used)?
   - Any known limitations or follow-up work needed?

3. **The build must pass.** Run `npm run lint && npm run build` locally before pushing. PRs that break the build will not be reviewed until they are green.

4. **Update documentation** if your change affects:
   - An environment variable → update `.env.example`
   - Pipeline behaviour or thresholds → update `ARCHITECTURE.md`
   - A user-facing feature → update `README.md`
   - Any notable change → add an entry to `CHANGELOG.md` under `[Unreleased]`

5. **Keep commits clean.** Squash fixup commits before requesting review. A clean linear history makes future `git bisect` runs much easier.

6. **Expect review feedback.** Reviewers may ask for changes to logic, naming, or structure. Iterate until the PR is in a mergeable state — it will then be squash-merged into `main`.

---

## 11. Security

**Never commit real API keys, tokens, or secrets.**

- Use `.env.local` for all secrets during development — it is listed in `.gitignore` and will never be committed.
- Use `.env.example` (with placeholder values only) to document what variables are needed — always commit this file.
- If you accidentally commit a secret, **rotate the key immediately** and rewrite the git history to remove it (`git filter-branch` or `git filter-repo`).
- Do not hardcode tokens in source files. If you find a hardcoded token anywhere in the codebase, file an issue or open a PR to move it to an environment variable.

---

## 12. Reporting Issues

Open a GitHub Issue with the following information:

- **A clear title** — e.g. `"Instagram scraper fails for carousel posts"`, `"Geocoder returns wrong country for Korean place names"`
- **Steps to reproduce** — include the social media URL if it is a public post
- **Expected behaviour** vs. **actual behaviour**
- **Server log output** — copy the terminal from `npm run dev` while reproducing the issue (redact any API keys if they appear)
- **Environment** — OS, Node.js version, which environment variables are set (not their values — just which ones)

Feature requests are welcome — label them `enhancement`.

---

## License

By contributing to VOYGE.studio, you agree that your contributions will be governed by the project's proprietary license. See [`LICENSE`](./LICENSE) for details.