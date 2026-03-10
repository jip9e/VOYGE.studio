# VOYGE Location Extraction — Comprehensive Research & Strategy Guide

---

## 📋 Summary

> This is the **internal research document** for VOYGE.studio's 5-stage location extraction pipeline. It catalogues every API, NLP technique, confidence scoring model, and architecture pattern that was evaluated when building the system that turns an Instagram Reel or TikTok URL into a GPS coordinate.

### What each pipeline stage does

| Stage | Module | What it does |
|-------|--------|-------------|
| **1 — Zero-Compute Extraction** | `extractor.ts` | Pulls ranked place-name candidate strings from all available text signals (caption, hashtags, geo-hashtags, creator replies, anchor stickers, bio, music title, tagged accounts) without making any network calls. Applies comment vote triangulation and geo-word vote passes to boost high-confidence candidates. |
| **2 — Multi-API Geocoding Cascade** | `geocoder.ts` | Geocodes each candidate through up to 7 services in priority order — Mapbox SearchBox → Mapbox V5 → Nominatim → GeoNames → HERE → OpenCage → Overpass OSM — stopping when a result meets the confidence floor. Country hinting and natural-feature routing improve accuracy. |
| **3 — Knowledge Verification** | `verifier.ts` | Cross-references the geocoded result against the Wikipedia REST API (article existence + disambiguation check) and the Google Knowledge Graph API (entity confidence scoring). Boosts confidence for verified real-world places; penalizes results with no knowledge base presence. |
| **4 — Visual Landmark Detection** | `vision.ts` | Sends the video thumbnail to the Google Cloud Vision API landmark detection endpoint. If a famous landmark is identified in the image, its name and GPS coordinates are returned as a high-confidence override. Runs in parallel with Stages 1–3. |
| **5 — AI Tool-Calling Agent** | `ai-agent.ts` | A GPT-5 agent (via GitHub Models / Azure AI Inference) invoked as a last resort when the best pipeline result falls below the `AI_AGENT_THRESHOLD` (0.60). The agent has access to geocoding and verification tools, reasons over all available signals, and is subject to a 45-second global deadline and a maximum of 4 tool-call iterations. |

### Key thresholds

| Constant | Value | Effect |
|----------|-------|--------|
| `GEOCODE_CONFIDENCE_FLOOR` | `0.55` | Candidates below this floor skip the geocoder entirely |
| `AI_AGENT_THRESHOLD` | `0.60` | AI agent is invoked if the best pipeline result is below this |
| `RETURN_THRESHOLD` | `0.65` | Final results below this are discarded and no pin is saved |

### Research scope

The sections below document every option that was researched and evaluated — including services that were ultimately **not** adopted. They serve as a reference for future improvements, cost optimisation decisions, and onboarding new contributors to the pipeline.

---

> **Status:** Living document | Last updated for VOYGE production pipeline  
> **Scope:** Every API, technique, and architecture pattern relevant to extracting real-world GPS coordinates from TikTok and Instagram posts.

---

## Table of Contents

1. [Free/Cheap Geocoding APIs](#1-freecheap-geocoding-apis)
2. [NLP / Entity Recognition for Place Names](#2-nlp--entity-recognition-for-place-names)
3. [Wikipedia / Wikidata as a Place Verification Layer](#3-wikipedia--wikidata-as-a-place-verification-layer)
4. [Google Knowledge Graph](#4-google-knowledge-graph)
5. [OpenStreetMap Overpass API](#5-openstreetmap-overpass-api)
6. [Mapbox Geocoding Best Practices](#6-mapbox-geocoding-best-practices)
7. [AI Tool-Calling for Location (Agentic Pipeline)](#7-ai-tool-calling-for-location-agentic-pipeline)
8. [Video / Image Analysis — Landmark Detection](#8-video--image-analysis--landmark-detection)
9. [TikTok / Instagram Specific Signals](#9-tiktok--instagram-specific-signals)
10. [Cascaded Confidence Scoring — Industry Architecture](#10-cascaded-confidence-scoring--industry-architecture)
11. [Recommended Stack for VOYGE](#11-recommended-stack-for-voyge)
12. [Code Snippets & Integration Patterns](#12-code-snippets--integration-patterns)

---

## 1. Free/Cheap Geocoding APIs

### 1.1 OpenStreetMap Nominatim

| Property | Detail |
|---|---|
| **Endpoint** | `https://nominatim.openstreetmap.org/search?q=<query>&format=jsonv2` |
| **Cost** | Free (community-operated) |
| **Rate limit** | **1 request/second** strictly enforced. No bulk usage on OSM's servers. |
| **Self-hostable** | Yes — Docker image available, unlimited on your own infra |
| **Strengths** | Excellent for structured addresses; supports bounding box (`viewbox`), country filter (`countrycodes`), feature type filter (`featureType=natural`); returns OSM-linked data with Wikipedia links via `extratags=1` |
| **Weaknesses** | Poor on informal names ("that blue lagoon in Iceland"), struggles with misspellings, no fuzzy matching |
| **Best for VOYGE** | Fallback geocoder after Mapbox fails; self-host for high volume |

**Key parameters:**
```
q              — free-form query
viewbox        — lon1,lat1,lon2,lat2  (bias/limit to bounding box)
bounded=1      — hard-restrict to viewbox
countrycodes   — ISO 3166-1 alpha-2, e.g. "us,ca"
layer          — address | poi | natural | manmade
featureType    — country | state | city | settlement
extratags=1    — adds Wikipedia links, OSM extra data
addressdetails=1 — breaks address into components
```

**Example — find a natural feature in Oregon:**
```
GET https://nominatim.openstreetmap.org/search
  ?q=McKenzie+River+Oregon
  &format=jsonv2
  &featureType=natural
  &countrycodes=us
  &limit=3
  &email=your@email.com   ← required for production use
```

---

### 1.2 Photon (by Komoot)

| Property | Detail |
|---|---|
| **Endpoint** | `https://photon.komoot.io/api/?q=<query>` |
| **Cost** | Free (public instance, no auth required) |
| **Rate limit** | No official hard limit but intended for low-to-moderate use. Self-host for production. |
| **Self-hostable** | Yes — built on Elasticsearch, uses OpenStreetMap data |
| **Strengths** | Handles informal/natural language better than Nominatim; supports `lang` param; proximity bias via `lat`/`lon`; returns GeoJSON natively |
| **Weaknesses** | Smaller community, less enterprise support |
| **Best for VOYGE** | Good secondary geocoder for informal place names like "the pink lake in Australia" |

**Example:**
```
GET https://photon.komoot.io/api/
  ?q=Blue+Lagoon+Iceland
  &limit=3
  &lang=en
  &lat=64.0&lon=-22.0    ← proximity bias
```

**Response:** GeoJSON FeatureCollection — each feature has `geometry.coordinates`, `properties.name`, `properties.country`, `properties.city`, `properties.osm_type`.

---

### 1.3 GeoNames

| Property | Detail |
|---|---|
| **Endpoint** | `http://api.geonames.org/searchJSON?q=<name>&username=<user>` |
| **Cost** | Free tier: **1,000 API calls/hour**, 30,000/day (free account) |
| **Auth** | Free registration at geonames.org |
| **Strengths** | Massive database of 11M+ geographic names; supports feature class filtering (natural features = `H` for hydrosphere, `T` for mountains, `U` for undersea); returns population, elevation, timezone, bounding box |
| **Weaknesses** | Not great for POIs (restaurants, hotels); older data |
| **Best for VOYGE** | Excellent for natural features: rivers, mountains, lakes, parks. Feature classes: `H` (water), `T` (terrain), `L` (parks), `S` (spots/buildings) |

**Feature class filter example — find rivers only:**
```
GET http://api.geonames.org/searchJSON
  ?q=McKenzie+River
  &featureClass=H        ← H = hydrological features
  &featureCode=STM       ← STM = stream/river
  &country=US
  &maxRows=5
  &username=your_username
```

**Feature codes of interest:**
- `STM` — stream/river
- `LK` — lake
- `MT` — mountain
- `PRK` — park
- `FALL` — waterfall
- `BCH` — beach
- `CAVE` — cave

---

### 1.4 Google Places API (New)

| Property | Detail |
|---|---|
| **Endpoint** | `https://places.googleapis.com/v1/places:searchText` |
| **Cost** | $0.032/request (Text Search); **$200/month free credit** = ~6,250 free requests/month |
| **Auth** | API key, billed per request after free credit |
| **Strengths** | Best-in-class POI data; handles natural language extremely well ("best ramen in Tokyo near the temple"); returns photos, ratings, open hours, reviews; `fieldMask` lets you request only needed fields (saves money) |
| **Weaknesses** | Cost at scale; ToS restricts storing data |
| **Best for VOYGE** | High-confidence fallback for POIs (restaurants, cafes, hotels, attractions) |

**Text Search (New) request:**
```typescript
const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': process.env.GOOGLE_PLACES_KEY!,
    'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.types'
  },
  body: JSON.stringify({
    textQuery: "Shibuya Crossing Tokyo",
    locationBias: {
      circle: {
        center: { latitude: 35.6762, longitude: 139.6503 },
        radius: 50000.0
      }
    }
  })
});
```

---

### 1.5 HERE Maps Geocoding & Search

| Property | Detail |
|---|---|
| **Endpoint** | `https://geocode.search.hereapi.com/v1/geocode?q=<query>&apiKey=<key>` |
| **Cost** | Free tier: **250,000 transactions/month** |
| **Auth** | API key (free account) |
| **Strengths** | Excellent POI database; `discover` endpoint handles natural language; supports `at` (proximity) and `in` (bounding box/country) params; fast response times |
| **Weaknesses** | ToS restrictions on data storage |
| **Best for VOYGE** | Strong free tier makes it a viable primary geocoder at moderate scale |

**Example — Discover (natural language POI search):**
```
GET https://discover.search.hereapi.com/v1/discover
  ?q=waterfall+near+Portland+Oregon
  &at=45.5051,-122.6750    ← proximity
  &in=countryCode:USA
  &limit=5
  &apiKey=YOUR_KEY
```

---

### 1.6 OpenCage Geocoding API

| Property | Detail |
|---|---|
| **Endpoint** | `https://api.opencagedata.com/geocode/v1/json?q=<query>&key=<key>` |
| **Cost** | Free trial: **2,500 requests/day**. Paid from €50/month for 10,000+/day |
| **Auth** | API key |
| **Strengths** | Aggregates Nominatim + other sources; `bounds` parameter for bounding box bias; `countrycode` filter; **confidence score 0–10**; annotations include timezone, currency, what3words, sun rise/set; caching allowed permanently |
| **Weaknesses** | Free tier is trial-only, not for ongoing production |
| **Best for VOYGE** | Useful for its **confidence score** — you can use it to validate other geocoders' results |

**Confidence score interpretation:**
| Score | Precision |
|---|---|
| 10 | < 0.25 km |
| 9 | < 0.5 km |
| 7–8 | < 5 km |
| 4–6 | City level |
| 1–3 | Country/region level |

---

### 1.7 Foursquare Places API

| Property | Detail |
|---|---|
| **Endpoint** | `https://api.foursquare.com/v3/places/search?query=<q>&ll=<lat,lng>` |
| **Cost** | Free tier: **1,000 API calls/day** |
| **Auth** | Bearer token (free account) |
| **Strengths** | Best-in-class POI data for restaurants, cafes, bars, nightlife; returns unique Foursquare ID (stable permanent ID); good for user-generated content venues; `near` param accepts city names |
| **Weaknesses** | Poor for natural features (rivers, mountains) |
| **Best for VOYGE** | When a post is clearly about a restaurant, hotel, or urban POI |

**Example:**
```typescript
const res = await fetch(
  `https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(name)}&near=${encodeURIComponent(city)}&limit=3`,
  { headers: { Authorization: process.env.FOURSQUARE_KEY! } }
);
```

---

### 1.8 What3Words

| Property | Detail |
|---|---|
| **Endpoint** | `https://api.what3words.com/v3/convert-to-coordinates?words=<3wa>&key=<key>` |
| **Cost** | Free for development; paid for production |
| **Strengths** | Converts a 3-word address to exact GPS coordinates (3m precision); growing adoption in travel content |
| **Best for VOYGE** | Parse captions/comments for 3-word patterns like `///filled.count.soap` — rare but when present, gives exact coordinates |

**Detection regex:**
```typescript
const w3w = caption.match(/\/\/\/([a-z]+\.[a-z]+\.[a-z]+)/i)?.[1];
if (w3w) {
  // call what3words API for exact GPS
}
```

---

### 1.9 Pelias (Open Source Geocoder)

| Property | Detail |
|---|---|
| **Self-hosted** | Yes — `https://github.com/pelias/pelias` |
| **Cost** | Free (self-hosted); uses OpenStreetMap + Who's on First + OpenAddresses data |
| **Strengths** | Production-grade; Mapbox's geocoder is based on Pelias; supports autocomplete, fuzzy matching, multiple data sources; Docker Compose deployment |
| **Best for VOYGE** | If you want a fully self-hosted geocoder with no rate limits or costs at scale |

---

### Geocoding API Comparison Table

| API | Free Tier | Handles Natural Language | Natural Features | POIs | Self-Hostable |
|---|---|---|---|---|---|
| Nominatim | Unlimited (1 req/s) | Poor | Good | Moderate | ✅ |
| Photon | Unlimited (fair use) | Moderate | Good | Moderate | ✅ |
| GeoNames | 30K/day | Poor | Excellent | Poor | Partial |
| Google Places | $200/mo credit | Excellent | Moderate | Excellent | ❌ |
| HERE Geocoding | 250K/mo | Good | Good | Good | ❌ |
| OpenCage | 2,500/day | Moderate | Good | Moderate | ❌ |
| Foursquare | 1K/day | Good | Poor | Excellent | ❌ |
| Mapbox v5 | 100K/mo | Good | Good | Good | Partial |
| Mapbox SearchBox | 100K sessions/mo | Excellent | Good | Excellent | ❌ |
| Pelias | Unlimited | Good | Good | Good | ✅ |

---

## 2. NLP / Entity Recognition for Place Names

The goal is to extract GPE (Geopolitical Entity) and LOC (Location) named entities from short, informal, hashtag-heavy social media text like:

> "spent my whole morning here 😭🌊 #oregoncoast #pnw vibes were immaculate"

---

### 2.1 spaCy NER (Python)

| Property | Detail |
|---|---|
| **Cost** | Free, open source |
| **Models** | `en_core_web_sm` (fast), `en_core_web_trf` (transformer-based, accurate) |
| **Entity types** | `GPE` (cities, countries, states), `LOC` (natural locations), `FAC` (facilities), `ORG` |
| **Strengths** | Fast; runs locally; can be fine-tuned on travel content; the `trf` model is surprisingly good on informal text |
| **Weaknesses** | Struggles with hashtags, all-lowercase text, emojis, abbreviations; needs preprocessing |
| **Free tier** | Fully free and local |

**Preprocessing for social media text:**
```python
import spacy
import re

nlp = spacy.load("en_core_web_trf")

def preprocess_caption(text: str) -> str:
    # Split hashtags: #oregoncoast → oregon coast
    text = re.sub(r'#([a-zA-Z]+)', lambda m: ' '.join(
        re.findall('[A-Z][a-z]*|[a-z]+', m.group(1))
    ).title(), text)
    # Remove emojis
    text = re.sub(r'[^\x00-\x7F]+', ' ', text)
    return text.strip()

def extract_places(caption: str) -> list[dict]:
    doc = nlp(preprocess_caption(caption))
    places = []
    for ent in doc.ents:
        if ent.label_ in ("GPE", "LOC", "FAC"):
            places.append({
                "text": ent.text,
                "label": ent.label_,
                "confidence": "high" if ent.label_ == "GPE" else "medium"
            })
    return places
```

**Fine-tuning tip:** Creating a small labeled dataset (500–1,000 travel captions) and fine-tuning `en_core_web_sm` on GPE/LOC entities dramatically improves accuracy for hashtag text.

---

### 2.2 Stanford NER (Java/API)

| Property | Detail |
|---|---|
| **Cost** | Free, open source (GPL license) |
| **Deployment** | Java JAR (can wrap in a REST API) |
| **Strengths** | Strong academic track record; 7-class model includes `LOCATION` |
| **Weaknesses** | Java runtime required; slower than spaCy; not designed for social media text |
| **Best for VOYGE** | Not recommended — spaCy or cloud NLP are better choices |

---

### 2.3 Google Cloud Natural Language API

| Property | Detail |
|---|---|
| **Endpoint** | `https://language.googleapis.com/v1/documents:analyzeEntities` |
| **Cost** | **Free: first 5,000 units/month**. Then $1.00/1,000 units. |
| **Auth** | API key or service account |
| **Entity types** | `LOCATION`, `ADDRESS`, `EVENT`, `ORGANIZATION`, etc. |
| **Strengths** | Handles informal, multilingual text well; returns `salience` score (how central the entity is to the text); returns Wikipedia/Wikidata metadata ID for verified places; **works on raw TikTok captions without preprocessing** |
| **Best for VOYGE** | Strong choice for entity extraction with automatic Wikipedia verification built in |

**Request:**
```typescript
const response = await fetch(
  `https://language.googleapis.com/v1/documents:analyzeEntities?key=${process.env.GOOGLE_NLP_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      document: {
        type: 'PLAIN_TEXT',
        content: caption + ' ' + hashtags.join(' ')
      },
      encodingType: 'UTF8'
    })
  }
);

const data = await response.json();
const locationEntities = data.entities
  .filter((e: any) => e.type === 'LOCATION' || e.type === 'ADDRESS')
  .sort((a: any, b: any) => b.salience - a.salience);

// Each entity may have a metadata.wikipedia_url for verification!
```

**Key insight:** The response includes `metadata.wikipedia_url` and `metadata.mid` (Google Knowledge Graph ID) for recognized places — this gives you automatic place verification for free.

---

### 2.4 AWS Comprehend

| Property | Detail |
|---|---|
| **Endpoint** | AWS SDK — `comprehend.detectEntities({ Text, LanguageCode })` |
| **Cost** | Free tier: **50K units/month for 2 months**. Then $0.0001/unit. |
| **Entity types** | `LOCATION`, `PERSON`, `ORGANIZATION`, `DATE`, `QUANTITY` |
| **Strengths** | Strong on English text; easy integration if you're on AWS; supports batch processing |
| **Weaknesses** | Less context-aware than Google NLP; no Wikipedia metadata |
| **Best for VOYGE** | Good if you're AWS-native; otherwise Google NLP is better |

---

### 2.5 Azure Text Analytics (Azure AI Language)

| Property | Detail |
|---|---|
| **Endpoint** | `https://<resource>.cognitiveservices.azure.com/language/:analyze-text?api-version=2023-04-01` |
| **Cost** | Free tier: **5,000 text records/month** |
| **Entity types** | `GeographicRegion`, `GeographicCoordinates`, `Location`, `City`, `State`, `Country` |
| **Strengths** | More granular location sub-types than competitors; strong multilingual support (useful for non-English travel content); linked entities feature connects to Wikipedia |
| **Best for VOYGE** | **Particularly relevant** since VOYGE already uses Azure AI Inference SDK — you can add Azure Text Analytics from the same Azure resource |

**TypeScript example (using existing Azure SDK pattern):**
```typescript
import { TextAnalysisClient, AzureKeyCredential } from "@azure/ai-language-text";

const client = new TextAnalysisClient(
  process.env.AZURE_LANGUAGE_ENDPOINT!,
  new AzureKeyCredential(process.env.AZURE_LANGUAGE_KEY!)
);

const results = await client.analyze("EntityRecognition", [
  caption + ' ' + hashtags.join(' ')
]);

for (const result of results) {
  if (!result.error) {
    const locations = result.entities
      .filter(e => e.category === 'Location' || e.category === 'GeographicRegion')
      .sort((a, b) => b.confidenceScore - a.confidenceScore);
  }
}
```

---

### NLP Comparison for Social Media Text

| Tool | Informal Text | Hashtags | Multilingual | Wikipedia Link | Free Tier | Best For |
|---|---|---|---|---|---|---|
| spaCy trf | Good | Needs preprocessing | Limited | ❌ | Unlimited (local) | Offline/local pipeline |
| Google Cloud NLP | Excellent | Good | Excellent | ✅ Auto | 5K/mo | Best overall NLP |
| AWS Comprehend | Good | Moderate | Good | ❌ | 50K/2mo | AWS-native stacks |
| Azure Text Analytics | Good | Good | Excellent | ✅ Linked entities | 5K/mo | Azure-native (VOYGE!) |
| Stanford NER | Poor | Poor | Limited | ❌ | Unlimited (local) | Not recommended |

---

## 3. Wikipedia / Wikidata as a Place Verification Layer

### Why use Wikipedia as verification?

When your NLP or regex extracts the string `"Blue Lagoon"` from a caption, you don't know if it's the geothermal spa in Iceland, a beach in Malta, or a cocktail bar. Wikipedia/Wikidata can answer the question: **"Is this a real, known geographic place, and where exactly is it?"**

---

### 3.1 Wikipedia Search API

**Completely free, no auth required, no rate limits stated.**

**Endpoint 1 — Search:**
```
GET https://en.wikipedia.org/w/api.php
  ?action=query
  &list=search
  &srsearch=Blue+Lagoon+Iceland
  &format=json
  &utf8=1
  &srlimit=3
```

**Endpoint 2 — Get coordinates from a Wikipedia article:**
```
GET https://en.wikipedia.org/w/api.php
  ?action=query
  &titles=Blue+Lagoon+(geothermal+spa)
  &prop=coordinates|extracts|categories
  &exintro=true
  &format=json
```

Response includes `query.pages[id].coordinates[0].lat` and `.lon` — **this gives you direct GPS coordinates for the Wikipedia article topic**.

**Endpoint 3 — Geosearch (find Wikipedia articles near coordinates):**
```
GET https://en.wikipedia.org/w/api.php
  ?action=query
  &list=geosearch
  &gscoord=64.878|-22.449
  &gsradius=1000
  &gslimit=5
  &format=json
```

**TypeScript helper:**
```typescript
async function verifyPlaceWithWikipedia(placeName: string): Promise<{
  verified: boolean;
  coordinates?: [number, number];
  description?: string;
  pageUrl?: string;
} | null> {
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(placeName)}&format=json&utf8=1&srlimit=1`;
  
  const searchRes = await fetch(searchUrl, {
    headers: { 'User-Agent': 'VOYGE/1.0 (travel-app; contact@voyge.app)' }
  });
  const searchData = await searchRes.json();
  
  if (!searchData.query.search.length) return { verified: false };
  
  const title = searchData.query.search[0].title;
  
  const detailUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=coordinates|extracts&exintro=true&exsentences=2&format=json`;
  const detailRes = await fetch(detailUrl, {
    headers: { 'User-Agent': 'VOYGE/1.0 (travel-app; contact@voyge.app)' }
  });
  const detailData = await detailRes.json();
  
  const page = Object.values(detailData.query.pages)[0] as any;
  const coords = page.coordinates?.[0];
  
  return {
    verified: true,
    coordinates: coords ? [coords.lon, coords.lat] : undefined,
    description: page.extract?.replace(/<[^>]+>/g, '').slice(0, 200),
    pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`
  };
}
```

**Rate limiting:** Wikipedia asks for a `User-Agent` header identifying your app. No formal rate limit, but respect their servers — cache results aggressively.

---

### 3.2 Wikidata Query Service (SPARQL)

Wikidata is the structured data backbone behind Wikipedia. It lets you query for places with specific properties — **completely free, no auth required**.

**Endpoint:** `https://query.wikidata.org/sparql`

**Example — find all waterfalls in Oregon with coordinates:**
```sparql
SELECT ?place ?placeLabel ?coord WHERE {
  ?place wdt:P31 wd:Q瀑布;     # instance of: waterfall
         wdt:P131 wd:Q81688;  # located in: Oregon
         wdt:P625 ?coord.      # coordinate location
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 20
```

**JavaScript query:**
```typescript
const sparql = `
SELECT ?item ?itemLabel ?coord WHERE {
  ?item wdt:P31/wdt:P279* wd:Q23397;  # instance of lake (or subclass)
        wdt:P17 wd:Q30;                # country: USA
        wdt:P625 ?coord.
  ?item rdfs:label "${placeName}"@en.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 5`;

const res = await fetch(
  `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`
);
```

**Key Wikidata property codes for travel:**
- `P625` — coordinate location
- `P131` — located in administrative entity
- `P17` — country
- `P18` — image
- `P31` — instance of (Q23397=lake, Q4022=river, Q8502=mountain, Q23442=island, Q40080=beach)
- `Q5776954` — national park (US)

---

## 4. Google Knowledge Graph

### What it is

The Google Knowledge Graph Search API lets you search for entities (people, places, things) by name and returns structured entity data.

**Endpoint:** `https://kgsearch.googleapis.com/v1/entities:search?query=<name>&key=<key>&types=Place&limit=3`

**Cost:** **Free — up to 100,000 requests/day** (effectively unlimited for VOYGE's use case).

**Auth:** API key (no billing required for KG API).

**What it returns:**
- `@id` — unique Google Knowledge Graph identifier (e.g., `kg:/m/014lft`)
- `name` — canonical name of the place
- `description` — short description ("Geothermal spa in Iceland")
- `detailedDescription.articleBody` — Wikipedia excerpt
- `detailedDescription.url` — Wikipedia URL
- `@type` — schema.org types (e.g., `["Place", "TouristAttraction", "LandmarksOrHistoricalBuildings"]`)
- `image.url` — representative image

**TypeScript usage:**
```typescript
async function verifyPlaceWithKnowledgeGraph(
  placeName: string,
  contextHint?: string  // e.g. "Iceland" to disambiguate
): Promise<{
  verified: boolean;
  canonicalName?: string;
  description?: string;
  types?: string[];
  kgId?: string;
} | null> {
  const query = contextHint ? `${placeName} ${contextHint}` : placeName;
  const url = `https://kgsearch.googleapis.com/v1/entities:search?query=${encodeURIComponent(query)}&key=${process.env.GOOGLE_KG_KEY}&types=Place,TouristAttraction,NaturalPlace,LandmarksOrHistoricalBuildings&limit=3&indent=true`;
  
  const res = await fetch(url);
  const data = await res.json();
  
  const items = data.itemListElement;
  if (!items?.length) return { verified: false };
  
  const best = items[0].result;
  return {
    verified: true,
    canonicalName: best.name,
    description: best.description,
    types: best['@type'],
    kgId: best['@id']
  };
}
```

**Key insight:** If KG returns `@type` containing `Place`, `TouristAttraction`, `Park`, `Mountain`, etc., you have strong verification that the extracted name is a real location. The `description` field (e.g., "Geothermal spa in southwestern Iceland") gives you a disambiguation hint to pair with geocoding.

---

## 5. OpenStreetMap Overpass API

### What it is

Overpass API is a read-only API for querying OpenStreetMap's raw geodata. Unlike Nominatim (which does text search), Overpass lets you query by **geographic area + tags** — meaning you can answer questions like *"find all rivers named McKenzie within Oregon's bounding box."*

**Public servers (free):**
- `https://overpass-api.de/api/interpreter`
- `https://overpass.kumi.systems/api/interpreter`

**No auth required. Rate limits:** Soft — please don't hammer. The API has timeout and memory limits per query.

---

### How it solves "river in Oregon"

If your NLP extracts `"river"` from `#oregonriver` and `"Oregon"` from context, you can use Overpass to enumerate all rivers in Oregon, then pick the best match:

```
[out:json][timeout:25];
// First, get Oregon's bounding box
area["name"="Oregon"]["admin_level"="4"]->.oregon;
// Then find all waterways named something within that area
(
  way["waterway"="river"](area.oregon);
  relation["waterway"="river"](area.oregon);
);
out center;
```

**TypeScript implementation:**
```typescript
async function findNaturalFeatureInRegion(
  featureType: 'river' | 'lake' | 'waterfall' | 'mountain' | 'beach',
  regionName: string,
  featureName?: string
): Promise<Array<{ name: string; lat: number; lon: number; osmId: number }>> {
  
  const tagMap: Record<string, string> = {
    river: '"waterway"="river"',
    lake: '"natural"="water"["water"="lake"]',
    waterfall: '"waterway"="waterfall"',
    mountain: '"natural"="peak"',
    beach: '"natural"="beach"'
  };
  
  const nameFilter = featureName
    ? `["name"~"${featureName}",i]`
    : '["name"]';
  
  const query = `
    [out:json][timeout:25];
    area["name"="${regionName}"]->.region;
    (
      node[${tagMap[featureType]}]${nameFilter}(area.region);
      way[${tagMap[featureType]}]${nameFilter}(area.region);
    );
    out center 10;
  `;
  
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`
  });
  
  const data = await res.json();
  return data.elements
    .filter((el: any) => el.tags?.name)
    .map((el: any) => ({
      name: el.tags.name,
      lat: el.lat || el.center?.lat,
      lon: el.lon || el.center?.lon,
      osmId: el.id
    }));
}
```

**Practical use case for VOYGE:**

When you have a vague description like *"swimming hole in the McKenzie River Valley, Oregon"*:
1. NLP extracts `"McKenzie River"` and `"Oregon"`
2. Overpass query: find all nodes/ways tagged `waterway=river` with name matching `McKenzie` in Oregon
3. Returns `McKenzie River` with center coordinates
4. You now have a geocoded location without relying on AI guessing

---

### Overpass for Disambiguating Multiple Locations

If NLP returns `"Blue Lake"` (there are hundreds of Blue Lakes), you can use Overpass with `around` to find which one is most likely given other signals (e.g., `#oregon` hashtag):

```
[out:json][timeout:15];
area["name"="Oregon"]["admin_level"="4"]->.oregon;
(
  node["natural"="water"]["name"~"Blue Lake",i](area.oregon);
  way["natural"="water"]["name"~"Blue Lake",i](area.oregon);
);
out center 5;
```

---

## 6. Mapbox Geocoding Best Practices

### 6.1 Geocoding v5 vs. Search Box v1 — Key Differences

| Feature | Geocoding API v5 | Search Box API v1 |
|---|---|---|
| **Endpoint** | `/geocoding/v5/mapbox.places/{query}.json` | `/search/searchbox/v1/forward` |
| **Primary use** | Batch geocoding, server-side | Interactive user search |
| **Natural language** | Moderate | Excellent |
| **POI data** | Good (addresses + places) | Excellent (POIs, brands, categories) |
| **Pricing** | Per request (~100K/mo free) | Per session (suggest+retrieve = 1 session) |
| **Context response** | Array of context objects | Rich nested context object |
| **Proximity param** | `proximity=lon,lat` | `proximity=lon,lat` |
| **Bounding box** | `bbox=minLon,minLat,maxLon,maxLat` | `bbox=minLon,minLat,maxLon,maxLat` |
| **Type filter** | `types=place,poi,address` | `types=poi,address,place` |
| **`auto_complete`** | ❌ | ✅ (enables fuzzy/partial matching) |
| **Foursquare data** | ❌ | ✅ (`external_ids.foursquare`) |
| **Store results** | ❌ (ToS) | ❌ (ToS) |

**For VOYGE's server-side pipeline: use Geocoding v5 for batch processing and Search Box v1 for high-quality results on specific named places.**

---

### 6.2 Geocoding v5 — `proximity` and `bbox` Bias

The `proximity` param is a **soft bias** — results near the point get boosted in relevance ranking but don't block other results. The `bbox` param can be used as a **hard filter** with specific types.

```typescript
// Current VOYGE implementation pattern — add these optimizations:

async function geocodePlaceNameOptimized(
  name: string,
  cityHint?: string,
  countryCode?: string,  // ISO 3166-1 alpha-2
  proximityPoint?: [number, number]  // [lon, lat]
): Promise<GeoResult> {
  
  const query = cityHint ? `${name}, ${cityHint}` : name;
  
  const params = new URLSearchParams({
    access_token: process.env.NEXT_PUBLIC_MAPBOX_TOKEN!,
    limit: '5',
    types: 'poi,place,natural,landmark',
    language: 'en',
  });
  
  // Add country bias if we know it
  if (countryCode) {
    params.set('country', countryCode.toLowerCase());
  }
  
  // Add proximity bias if we have a known region
  if (proximityPoint) {
    params.set('proximity', `${proximityPoint[0]},${proximityPoint[1]}`);
  }
  
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const data = await res.json();
  
  return parseMapboxResponse(data);
}
```

**Tip — Country code from hashtags to bias geocoding:**
If you extract `#oregon` → `countryCode = 'us'`; `#bali` → `countryCode = 'id'`. This dramatically reduces false matches for ambiguous place names.

---

### 6.3 Search Box v1 for Natural Language

Search Box v1's `/forward` endpoint with `auto_complete=true` handles partial and fuzzy queries much better than v5:

```typescript
async function searchBoxForward(
  naturalLanguageQuery: string,  // e.g., "blue lagoon spa iceland"
  countryCode?: string
): Promise<GeoResult | null> {
  
  const params = new URLSearchParams({
    q: naturalLanguageQuery,
    access_token: process.env.NEXT_PUBLIC_MAPBOX_TOKEN!,
    limit: '3',
    language: 'en',
    auto_complete: 'true',
    types: 'poi,place,address'
  });
  
  if (countryCode) params.set('country', countryCode);
  
  const url = `https://api.mapbox.com/search/searchbox/v1/forward?${params}`;
  const res = await fetch(url);
  const data = await res.json();
  
  const best = data.features?.[0];
  if (!best) return null;
  
  return {
    coordinates: best.geometry.coordinates as [number, number],
    full_address: best.properties.full_address,
    mapbox_id: best.properties.mapbox_id,
    country: best.properties.context?.country?.name || '',
    city: best.properties.context?.place?.name || '',
    confidence: 'high',
    source: 'mapbox_searchbox_v1'
  };
}
```

**When to use v5 vs v1 in VOYGE's pipeline:**
- **v5:** When you have a clean place name extracted from a structured source (location tag, creator reply to "where is this?")
- **v1 `/forward`:** When the query is a more natural, multi-word phrase like `"hidden waterfall Columbia River Gorge"`
- **v1 `/suggest`+`/retrieve`:** Only in the front-end search bar (user typing), never in background pipeline

---

### 6.4 Mapbox `featureType` Filtering

Avoid false matches by filtering to the right feature type. For example, `"Portland"` in a caption about nature should not match `Portland, Maine` if hashtags say `#pnw`:

```typescript
// Type priority based on content classification
function inferMapboxTypes(category: string): string {
  const typeMap: Record<string, string> = {
    'natural': 'poi,place,natural',     // rivers, mountains
    'urban': 'poi,address,place',       // restaurants, hotels
    'neighborhood': 'neighborhood,locality,place',
    'landmark': 'poi,landmark',
    'country': 'country,region',
    'city': 'place,district'
  };
  return typeMap[category] || 'poi,place,address';
}
```

---

## 7. AI Tool-Calling for Location (Agentic Pipeline)

### 7.1 The Core Concept

Instead of a single AI prompt that must infer location in one shot, you give the AI a set of **callable tools** and let it reason iteratively:

```
User input: "Caption: 'found heaven on earth 🌊 #pnw #secretspot'"

AI thinks:
→ "PNW could be Pacific Northwest. Let me search for beaches/coves in PNW."
→ calls search_place("secret cove Pacific Northwest beach")
→ Gets back 5 candidates
→ "The hashtag #secretspot is common for Olympic Peninsula, let me verify"
→ calls verify_place("Hidden Beach Olympic Peninsula Washington")
→ Confirmed. Returns coordinates.
```

This is dramatically more accurate than single-shot extraction for ambiguous content.

---

### 7.2 Tool Definitions for Azure AI Inference SDK

VOYGE already uses `@azure-rest/ai-inference` pointing to `https://models.inference.ai.azure.com`. Here's how to add tool calling:

```typescript
import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

const client = ModelClient(
  "https://models.inference.ai.azure.com",
  new AzureKeyCredential(process.env.GITHUB_MODELS_TOKEN!)
);

// Define the tools the AI can call
const locationTools = [
  {
    type: "function" as const,
    function: {
      name: "search_place",
      description: "Search for a place by name or description. Returns top 3 matching locations with coordinates.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The place name or description to search for, e.g. 'Blue Lagoon Iceland' or 'waterfall Columbia River Gorge Oregon'"
          },
          country_code: {
            type: "string",
            description: "Optional ISO 3166-1 alpha-2 country code to bias results, e.g. 'us', 'is', 'id'"
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "verify_place",
      description: "Verify that a place name is real and get its Wikipedia description and coordinates.",
      parameters: {
        type: "object",
        properties: {
          place_name: {
            type: "string",
            description: "The exact place name to verify, e.g. 'Multnomah Falls'"
          },
          context: {
            type: "string",
            description: "Geographic context for disambiguation, e.g. 'Oregon USA' or 'Iceland'"
          }
        },
        required: ["place_name"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "search_nearby",
      description: "Search for places of a specific type near a set of coordinates.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number", description: "Latitude" },
          lon: { type: "number", description: "Longitude" },
          place_type: {
            type: "string",
            enum: ["waterfall", "lake", "river", "beach", "mountain", "restaurant", "cafe", "hotel", "park", "viewpoint"],
            description: "Type of place to search for"
          },
          radius_km: {
            type: "number",
            description: "Search radius in kilometers, default 10"
          }
        },
        required: ["lat", "lon", "place_type"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "search_in_region",
      description: "Search for natural features (rivers, lakes, mountains) by name within a named region/state/country.",
      parameters: {
        type: "object",
        properties: {
          feature_name: {
            type: "string",
            description: "Name or partial name of the feature, e.g. 'McKenzie'"
          },
          region: {
            type: "string",
            description: "Region/state/country name, e.g. 'Oregon', 'Iceland', 'Bali'"
          },
          feature_type: {
            type: "string",
            enum: ["river", "lake", "waterfall", "mountain", "beach", "forest", "any"],
            description: "Type of natural feature"
          }
        },
        required: ["region", "feature_type"]
      }
    }
  }
];
```

---

### 7.3 The Agentic Loop Implementation

```typescript
// Tool execution handler
async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  switch (name) {
    case 'search_place': {
      const result = await geocodePlaceName(args.query, args.country_code);
      return JSON.stringify({ 
        found: result.confidence !== 'failed',
        coordinates: result.coordinates,
        full_address: result.full_address,
        confidence: result.confidence
      });
    }
    case 'verify_place': {
      const result = await verifyPlaceWithWikipedia(
        args.place_name + (args.context ? ` ${args.context}` : '')
      );
      return JSON.stringify(result);
    }
    case 'search_nearby': {
      const results = await findNearbyWithOverpass(args.lat, args.lon, args.place_type, args.radius_km || 10);
      return JSON.stringify(results.slice(0, 3));
    }
    case 'search_in_region': {
      const results = await findNaturalFeatureInRegion(args.feature_type, args.region, args.feature_name);
      return JSON.stringify(results.slice(0, 3));
    }
    default:
      return JSON.stringify({ error: 'Unknown tool' });
  }
}

// Main agentic extraction
async function agentExtractLocation(context: string): Promise<{
  name: string;
  coordinates: [number, number];
  confidence: number;
} | null> {
  
  const messages: any[] = [
    {
      role: "system",
      content: `You are a location extraction specialist for a travel app. 
      Given social media post data, identify the exact real-world location being shown.
      Use the available tools to search and verify locations. 
      Be iterative — if your first search is ambiguous, refine it.
      When confident, respond with JSON: { "name": "...", "coordinates": [lon, lat], "confidence": 0-1 }`
    },
    {
      role: "user",
      content: context
    }
  ];
  
  // Agentic loop — max 5 iterations
  for (let i = 0; i < 5; i++) {
    const response = await client.path("/chat/completions").post({
      body: {
        messages,
        model: "gpt-4o",
        tools: locationTools,
        tool_choice: "auto",
        response_format: { type: "text" }
      }
    });
    
    const choice = (response.body as any).choices[0];
    const message = choice.message;
    
    messages.push(message);
    
    // If AI made tool calls, execute them and feed results back
    if (choice.finish_reason === 'tool_calls' && message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        const result = await executeTool(
          toolCall.function.name,
          JSON.parse(toolCall.function.arguments)
        );
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result
        });
      }
      continue; // Next iteration
    }
    
    // AI gave a final answer
    if (choice.finish_reason === 'stop') {
      try {
        return JSON.parse(message.content);
      } catch {
        return null;
      }
    }
  }
  
  return null; // Max iterations reached
}
```

---

### 7.4 Cost/Performance Tradeoffs

| Approach | Latency | Cost/call | Accuracy |
|---|---|---|---|
| Single-shot AI prompt (current) | ~2s | ~$0.002 | 70–80% |
| AI + 1 geocoder call (current direct geocode) | ~3s | ~$0.003 | 85–90% |
| Agentic (2–3 tool calls) | ~6–8s | ~$0.008–0.015 | 92–97% |
| Agentic (max 5 tool calls) | ~12s | ~$0.02–0.04 | 95–99% |

**Recommendation:** Use agentic mode only for low-confidence results. Run single-shot first — if confidence < 0.6, escalate to agentic. This hybrid approach gives near-agentic accuracy at ~1.5x the cost of single-shot.

---

## 8. Video / Image Analysis — Landmark Detection

### 8.1 Google Cloud Vision API — Landmark Detection

**This is the most powerful image-based location signal available.**

| Property | Detail |
|---|---|
| **Endpoint** | `POST https://vision.googleapis.com/v1/images:annotate` |
| **Cost** | **Free: first 1,000 requests/month**. Then $1.50/1,000 requests. |
| **What it detects** | Famous landmarks, natural features, famous buildings, tourist sites |
| **Output** | Landmark name + GPS coordinates + confidence score |
| **Coverage** | Excellent for globally famous landmarks; limited for regional/local spots |

**Example response for a photo of the Eiffel Tower:**
```json
{
  "landmarkAnnotations": [{
    "mid": "/m/02j81",
    "description": "Eiffel Tower",
    "score": 0.9654,
    "locations": [{"latLng": {"latitude": 48.8584, "longitude": 2.2945}}]
  }]
}
```

**TypeScript integration:**
```typescript
async function detectLandmarkFromImageUrl(imageUrl: string): Promise<{
  name: string;
  coordinates: [number, number];
  confidence: number;
} | null> {
  
  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { source: { imageUri: imageUrl } },
          features: [{ type: 'LANDMARK_DETECTION', maxResults: 3 }]
        }]
      })
    }
  );
  
  const data = await response.json();
  const best = data.responses?.[0]?.landmarkAnnotations?.[0];
  
  if (!best || best.score < 0.4) return null;
  
  const loc = best.locations?.[0]?.latLng;
  if (!loc) return null;
  
  return {
    name: best.description,
    coordinates: [loc.longitude, loc.latitude],
    confidence: best.score
  };
}
```

**Integration point in VOYGE:** When `richData.thumbnail` is available, run landmark detection in parallel with NLP extraction. If vision returns a high-confidence result (score > 0.7), use it as the primary signal and skip AI text extraction entirely.

---

### 8.2 AWS Rekognition

| Property | Detail |
|---|---|
| **Endpoint** | AWS SDK — `rekognition.detectLabels()` |
| **Cost** | Free tier: **5,000 images/month for 12 months**. Then $0.001/image. |
| **What it detects** | Labels (`Waterfall`, `Mountain`, `Beach`, `Building`, etc.) + scene descriptors |
| **Key difference from Vision** | Does NOT return GPS coordinates — only labels and confidence scores |
| **Best for VOYGE** | Scene/category classification (is this a beach? a city? a forest?) to inform the Mapbox geocoding strategy |

**Use case in VOYGE:**
```typescript
const labels = await rekognition.detectLabels({ Image: { Bytes: thumbnailBytes } }).promise();
const isNaturalScene = labels.Labels?.some(l => 
  ['Waterfall', 'River', 'Mountain', 'Forest', 'Beach', 'Lake', 'Canyon'].includes(l.Name!)
  && (l.Confidence || 0) > 70
);
// If isNaturalScene, bias Mapbox search toward natural feature types
```

---

### 8.3 Azure Computer Vision (Landmark Detection)

| Property | Detail |
|---|---|
| **Endpoint** | `https://<resource>.cognitiveservices.azure.com/computervision/imageanalysis:analyze?features=tags,caption&model-version=latest&api-version=2023-02-01-preview` |
| **Cost** | Free tier: **5,000 transactions/month** |
| **Note** | Azure's landmark detection model was deprecated in 2024 in the newer API version. The `tags` feature still returns location-relevant labels. The older Vision v3.2 API still has `landmarks` as a visual feature. |
| **Best for VOYGE** | Since VOYGE is Azure-native, this integrates cleanly with existing Azure credentials |

---

### 8.4 Image Analysis Pipeline

```
Thumbnail URL available?
     │
     ├─ YES ─→ Run in PARALLEL:
     │          ├─ Google Vision Landmark Detection
     │          └─ AWS Rekognition scene labels (to classify feature type)
     │
     │          If Vision confidence > 0.7 → USE AS PRIMARY SIGNAL (skip AI text)
     │          If Vision confidence 0.4–0.7 → USE AS CORROBORATION SIGNAL
     │          If Vision confidence < 0.4 → IGNORE (fall through to text pipeline)
     │
     └─ NO  ─→ Skip image analysis, proceed to text pipeline
```

---

## 9. TikTok / Instagram Specific Signals

### 9.1 Signals Already in VOYGE Pipeline

- ✅ Native location tag (`location_name`, `location_lat`, `location_lng`)
- ✅ Caption text
- ✅ Hashtags
- ✅ Top comments
- ✅ User bio
- ✅ Creator replies to location questions
- ✅ Anchor locations (explicit place mentions)

---

### 9.2 Under-Exploited Signals

#### Music Track Name / Audio

TikTok's audio data is often location-coded:
- Songs like *"Hotel California"*, *"New York, New York"*, *"Midnight in Tokyo"* strongly suggest a location
- Regional music (e.g., flamenco → Spain; samba → Brazil; K-pop covers → South Korea) can provide country-level hints
- Trending sounds named after locations (e.g., *"Santorini by KSHMR"*) are heavily used in destination travel content

**Implementation:**
```typescript
const LOCATION_SONG_MAP: Record<string, string> = {
  'hotel california': 'California, USA',
  'new york new york': 'New York, USA',
  'viva las vegas': 'Las Vegas, USA',
  'under the tuscan sun': 'Tuscany, Italy',
  'kokomo': 'Caribbean',
  'santorini': 'Santorini, Greece',
  'marrakech': 'Marrakech, Morocco',
  'bali': 'Bali, Indonesia',
};

function extractLocationFromAudio(audioTitle: string): string | null {
  const lower = audioTitle.toLowerCase();
  for (const [key, location] of Object.entries(LOCATION_SONG_MAP)) {
    if (lower.includes(key)) return location;
  }
  return null;
}
```

---

#### Tagged Users / Account Context

If a creator tags another user in a post and that user's account is:
- A location-specific travel account (`@visitoregon`, `@explorebali`)
- A hotel/restaurant/destination brand account
- A local guide account

...that tagged account's location metadata is a strong signal.

**Pattern:**
```typescript
// Check if tagged accounts have location keywords in username/bio
const locationAccounts = taggedUsers.filter(u => 
  /visit|explore|discover|travel|guide|tourism/i.test(u.username) ||
  /oregon|bali|paris|tokyo|iceland|norway/i.test(u.username)
);
```

---

#### Sticker & Overlay Text

TikTok and Instagram Reels frequently have **text overlays** added during editing that say things like:
- `"POV: you found the secret spot"`
- `"Kotor, Montenegro 🇲🇪"`
- `"Hidden gem in Bali"`

These are not in the caption — they're in the video frames. Solutions:
1. **Google Video Intelligence API** — transcribes text overlays via `TEXT_DETECTION` feature
2. **Frame extraction + Google Vision OCR** — extract a keyframe, run OCR on it
3. **TikTok Describe API** (when available) — some TikTok API endpoints include auto-generated text overlay transcripts

```typescript
// Google Cloud Video Intelligence — text detection in video
const videoFeatures = ['TEXT_DETECTION', 'SHOT_CHANGE_DETECTION'];
// This would surface "Kotor, Montenegro" from a text overlay
```

---

#### Geotag from `#` Emoji Patterns

Some creators use patterns like:
- `📍 Positano, Italy`
- `🌍 Exploring Tokyo`
- `📌 Secret beach, Sardinia`
- `🗺️ somewhere in Oregon`

```typescript
const PIN_PATTERNS = [
  /📍\s*([A-Za-z\s,]+)/,
  /📌\s*([A-Za-z\s,]+)/,
  /🌍\s*([A-Za-z\s,]+)/,
  /🗺️\s*([A-Za-z\s,]+)/,
  /📺\s*([A-Za-z\s,]+)/,   // less common
];

function extractFromPinEmoji(text: string): string | null {
  for (const pattern of PIN_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]?.trim().length > 2) {
      return match[1].trim().split('\n')[0]; // First line only
    }
  }
  return null;
}
```

---

#### Geofenced Hashtag Analysis

Some hashtags are near-exclusively associated with specific locations:
- `#oregonexplored` → Oregon, USA (99% confidence)
- `#visitnorway` → Norway (99% confidence)
- `#halongbay` → Ha Long Bay, Vietnam (99% confidence)
- `#banff` → Banff, Canada (97% confidence)
- `#amalfi` → Amalfi Coast, Italy (95% confidence)

VOYGE's `geo.ts` already has a `KNOWN_GEO_HASHTAGS` map — this should be continuously expanded. Consider:
1. Maintaining a **JSON database** of ~2,000 location-specific hashtags
2. Scoring hashtag specificity (country-level = low, city-level = medium, landmark-level = high)
3. Using multiple hashtags to **triangulate** — if `#italy`, `#amalfi`, `#positano` all appear, confidence is very high

---

#### Creator's Historical Posts

If you can build a creator profile over time:
- A creator who has posted 15 times with `#pnw` and `#oregon` likely lives in/near Oregon
- If their new post has `#secretspot` without location, the prior context (Oregon-based creator) is a strong prior

---

### 9.3 Signal Priority Stack (Recommended for VOYGE)

```
Priority 1 (CERTAIN — skip further processing):
  ├─ Native GPS coordinates from post metadata
  └─ what3words pattern in caption/comment

Priority 2 (HIGH — 90%+ confidence):
  ├─ Location tag name (e.g., "Positano, Italy")
  ├─ Creator reply to "where is this?" question
  ├─ Google Vision landmark (score > 0.8)
  ├─ Pin emoji pattern (📍 Place Name)
  └─ Verified anchor location mention

Priority 3 (MEDIUM — 70–90% confidence):
  ├─ Explicit place mention in caption ("at McKenzie River")
  ├─ Known geo-hashtag (single, high-specificity)
  ├─ Google Vision landmark (score 0.5–0.8)
  ├─ NLP GPE entity extraction (Google Cloud NLP)
  └─ Multiple corroborating hashtags

Priority 4 (LOW — 40–70% confidence):
  ├─ Bio location extraction
  ├─ AI inference from vague description
  ├─ Scene classification (Rekognition) + region hashtag
  └─ Audio/music location signal

Priority 5 (FALLBACK — <40% confidence):
  ├─ Creator historical location profile
  ├─ Tagged user location accounts
  └─ Agentic AI search (run only if all above fail)
```

---

## 10. Cascaded Confidence Scoring — Industry Architecture

### 10.1 The Core Pattern: Signal Fusion

The industry-standard approach for multi-source location extraction is **Signal Fusion with Confidence Decay**:

```
┌─────────────────────────────────────────────────────────────┐
│                    SIGNAL EXTRACTION LAYER                   │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────────┐ │
│  │ Native  │ │   NLP    │ │  Image   │ │  Hashtag/Emoji  │ │
│  │  GPS    │ │ Entities │ │ Landmark │ │    Patterns     │ │
│  └────┬────┘ └────┬─────┘ └────┬─────┘ └────────┬────────┘ │
└───────┼───────────┼────────────┼─────────────────┼──────────┘
        │           │            │                 │
        ▼           ▼            ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                    GEOCODING LAYER                           │
│  ┌─────────────┐ ┌──────────────┐ ┌────────────────────┐   │
│  │   Mapbox    │ │  Wikipedia/  │ │    Google Places   │   │
│  │  v5/SBv1   │ │   Wikidata   │ │    / GeoNames      │   │
│  └──────┬──────┘ └──────┬───────┘ └─────────┬──────────┘   │
└─────────┼───────────────┼────────────────────┼──────────────┘
          │               │                    │
          ▼               ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                  SIGNAL FUSION & SCORING                     │
│                                                              │
│  For each candidate location:                                │
│    score = Σ (signal_weight × signal_confidence)            │
│                                                              │
│  Apply decay factors:                                        │
│    × geocoder_confidence (0.0–1.0)                          │
│    × source_reliability (native_gps=1.0, ai=0.6)           │
│    × corroboration_bonus (multiple sources agree = +0.15)   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    DECISION LAYER                            │
│                                                              │
│  score > 0.85 → HIGH confidence, save immediately           │
│  score 0.60–0.85 → MEDIUM, save with flag for review        │
│  score 0.40–0.60 → LOW, show to user for confirmation       │
│  score < 0.40 → FAILED, return "location not found"         │
└─────────────────────────────────────────────────────────────┘
```

---

### 10.2 Concrete Scoring Formula

```typescript
interface LocationCandidate {
  name: string;
  coordinates: [number, number];
  source: string;
  rawSignalConfidence: number;  // 0–1 from the extractor
  geocoderConfidence: number;   // 0–1 from geocoder
  sources: string[];            // which signals contributed
}

interface ScoringWeights {
  native_gps: number;
  location_tag: number;
  creator_reply: number;
  vision_landmark: number;
  pin_emoji: number;
  explicit_mention: number;
  geo_hashtag: number;
  nlp_entity: number;
  bio_extraction: number;
  ai_inference: number;
  audio_signal: number;
}

const SIGNAL_WEIGHTS: ScoringWeights = {
  native_gps: 1.00,
  location_tag: 0.95,
  creator_reply: 0.90,
  vision_landmark: 0.85,
  pin_emoji: 0.82,
  explicit_mention: 0.78,
  geo_hashtag: 0.70,
  nlp_entity: 0.65,
  bio_extraction: 0.55,
  ai_inference: 0.60,
  audio_signal: 0.40,
};

function computeLocationScore(candidate: LocationCandidate): number {
  // Base score from signal weight × signal confidence
  const signalWeight = SIGNAL_WEIGHTS[candidate.source as keyof ScoringWeights] || 0.5;
  let score = signalWeight * candidate.rawSignalConfidence;
  
  // Multiply by geocoder confidence
  score *= candidate.geocoderConfidence;
  
  // Corroboration bonus: multiple independent sources agree
  if (candidate.sources.length > 1) {
    score = Math.min(1.0, score + 0.10 * (candidate.sources.length - 1));
  }
  
  // Penalty for overly generic locations (country/region level)
  if (candidate.geocoderConfidence < 0.3) {
    score *= 0.5;  // Penalize very vague results
  }
  
  return Math.round(score * 100) / 100;
}

function categorizeConfidence(score: number): 'high' | 'medium' | 'low' | 'failed' {
  if (score >= 0.80) return 'high';
  if (score >= 0.55) return 'medium';
  if (score >= 0.35) return 'low';
  return 'failed';
}
```

---

### 10.3 Cascaded Fallback Pipeline (Production Architecture)

```typescript
async function cascadedLocationExtraction(
  richData: RichPostData
): Promise<ProcessedSpot | null> {

  const candidates: LocationCandidate[] = [];

  // ── STAGE 1: Zero-computation signals ──────────────────────────────────
  
  if (richData.location_lat && richData.location_lng) {
    // Native GPS — highest possible confidence, return immediately
    return buildSpotFromGPS(richData);
  }
  
  const pinEmoji = extractFromPinEmoji(richData.caption);
  if (pinEmoji) {
    const geo = await geocodePlaceName(pinEmoji);
    if (geo.confidence !== 'failed') {
      candidates.push({ source: 'pin_emoji', rawSignalConfidence: 0.9, geocoderConfidence: mapConfToFloat(geo.confidence), ...geo });
    }
  }
  
  // ── STAGE 2: Direct text extraction (fast, cheap) ───────────────────────
  
  const explicitPlace = extractExplicitPlaceName(richData);
  if (explicitPlace) {
    const geo = await geocodePlaceName(explicitPlace.name);
    candidates.push({ source: explicitPlace.source, rawSignalConfidence: mapExplicitConf(explicitPlace.confidence), geocoderConfidence: mapConfToFloat(geo.confidence), ...geo });
  }
  
  // ── STAGE 3: Image analysis (parallel with text) ────────────────────────
  
  if (richData.thumbnail) {
    const landmark = await detectLandmarkFromImageUrl(richData.thumbnail);
    if (landmark && landmark.confidence > 0.4) {
      candidates.push({ source: 'vision_landmark', rawSignalConfidence: landmark.confidence, geocoderConfidence: 0.95, name: landmark.name, coordinates: landmark.coordinates, sources: ['vision'] });
    }
  }
  
  // ── STAGE 4: Wikipedia/KG verification of best candidate ────────────────
  
  const scoredCandidates = candidates
    .map(c => ({ ...c, score: computeLocationScore(c) }))
    .sort((a, b) => b.score - a.score);
  
  const best = scoredCandidates[0];
  
  if (best && best.score >= 0.75) {
    // High confidence — return now
    return buildSpot(best, richData);
  }
  
  if (best && best.score >= 0.50) {
    // Medium confidence — try to verify with Wikipedia
    const wiki = await verifyPlaceWithWikipedia(best.name);
    if (wiki?.verified && wiki.coordinates) {
      // Wiki confirmed — boost confidence
      return buildSpot({ ...best, coordinates: wiki.coordinates, score: Math.min(1.0, best.score + 0.15) }, richData);
    }
  }
  
  // ── STAGE 5: NLP entity extraction (moderate cost) ──────────────────────
  
  const nlpEntities = await extractWithGoogleNLP(richData.caption + ' ' + richData.hashtags.join(' '));
  for (const entity of nlpEntities.slice(0, 2)) {
    const geo = await geocodePlaceName(entity.name, entity.context);
    candidates.push({ source: 'nlp_entity', rawSignalConfidence: entity.salience, geocoderConfidence: mapConfToFloat(geo.confidence), ...geo });
  }
  
  // Re-score with new candidates
  const rescored = candidates
    .map(c => ({ ...c, score: computeLocationScore(c) }))
    .sort((a, b) => b.score - a.score);
  
  if (rescored[0]?.score >= 0.50) {
    return buildSpot(rescored[0], richData);
  }
  
  // ── STAGE 6: AI extraction (expensive, most capable) ────────────────────
  
  const aiResult = await extractSpotData(richData);
  if (aiResult?.travel_spots?.length > 0) {
    const aiSpot = aiResult.travel_spots[0];
    const geo = await geocodePlaceName(aiSpot.name, aiSpot.city);
    const aiCandidate = { source: 'ai_inference', rawSignalConfidence: 0.7, geocoderConfidence: mapConfToFloat(geo.confidence), ...geo };
    candidates.push(aiCandidate);
  }
  
  // ── STAGE 7: Agentic loop (most expensive, last resort) ─────────────────
  
  const finalBest = candidates
    .map(c => ({ ...c, score: computeLocationScore(c) }))
    .sort((a, b) => b.score - a.score)[0];
  
  if (!finalBest || finalBest.score < 0.35) {
    // Nothing worked — try agentic AI
    const agentResult = await agentExtractLocation(buildContextString(richData));
    if (agentResult && agentResult.confidence > 0.5) {
      return buildSpotFromAgent(agentResult, richData);
    }
    return null; // Genuinely cannot determine location
  }
  
  return buildSpot(finalBest, richData);
}
```

---

### 10.4 Corroboration Scoring

When multiple independent signals point to the same location, confidence increases multiplicatively:

```typescript
function scoreWithCorroboration(
  primaryScore: number,
  corroboratingSignals: Array<{ source: string; confidence: number }>
): number {
  let score = primaryScore;
  
  for (const signal of corroboratingSignals) {
    // Each corroborating signal adds a diminishing bonus
    const bonus = signal.confidence * 0.1 * (1 - score); // Asymptotic to 1.0
    score += bonus;
  }
  
  return Math.min(1.0, score);
}

// Example:
// Primary: AI says "Positano" with 0.70 confidence
// Corroborating: #positano hashtag (0.95), #amalficoast (0.80), pin emoji "Positano" (0.90)
// → score = 0.70 + (0.95×0.1×0.30) + (0.80×0.1×0.27) + (0.90×0.1×0.25)
// → score ≈ 0.70 + 0.029 + 0.022 + 0.023 = 0.774 → HIGH confidence
```

---

## 11. Recommended Stack for VOYGE

### Recommended API Selection (Optimized for Cost & Accuracy)

| Layer | Primary | Secondary | Tertiary |
|---|---|---|---|
| **Geocoding** | Mapbox v5 (current ✅) | HERE (250K/mo free) | Nominatim (self-hosted) |
| **NLP** | Azure Text Analytics (Azure-native) | Google Cloud NLP ($5K free) | spaCy (local fallback) |
| **Place Verification** | Wikipedia API (free) | Google KG (100K/day free) | — |
| **Natural Features** | GeoNames (30K/day free) | Overpass API (free) | — |
| **Image Landmark** | Google Vision (1K/mo free) | — | — |
| **POIs** | Mapbox SearchBox v1 | Foursquare (1K/day free) | Google Places |
| **AI Extraction** | GPT-5 via Azure (current ✅) | — | — |
| **Agentic Loop** | GPT-5 with tool calling | — | — |

### Immediate High-ROI Improvements to VOYGE

1. **Add `extractFromPinEmoji()`** — captures `📍 Place Name` patterns before any AI call. ~0ms latency, 0 cost.

2. **Add Wikipedia verification** — free API, dramatically reduces false geocodes. 5–10% accuracy improvement.

3. **Add Google Vision landmark detection** — $1.50/1,000 images after free tier. For thumbnail-bearing posts, can replace entire AI pipeline when landmark confidence > 0.7.

4. **Expand `KNOWN_GEO_HASHTAGS`** — current map has ~60 entries. A curated list of 2,000 travel hashtags gives you a high-confidence free signal for a huge % of travel posts.

5. **Add Azure Text Analytics NLP** — you're already on Azure; adding the Language service is a few lines. Will extract location entities from captions the current regex pipeline misses.

6. **Add `countrycodes` bias to Mapbox calls** — when a hashtag gives you a country hint (`#japan` → `jp`), passing `country=jp` to Mapbox dramatically reduces false matches.

---

## 12. Code Snippets & Integration Patterns

### 12.1 Wikipedia Place Verification (Drop-in for VOYGE)

```typescript
// Add to geo.ts

export async function verifyWithWikipedia(
  placeName: string,
  contextHint?: string
): Promise<{ verified: boolean; coordinates?: [number, number]; wikiUrl?: string } | null> {
  
  const query = contextHint ? `${placeName} ${contextHint}` : placeName;
  const searchUrl = new URL('https://en.wikipedia.org/w/api.php');
  searchUrl.searchParams.set('action', 'query');
  searchUrl.searchParams.set('list', 'search');
  searchUrl.searchParams.set('srsearch', query);
  searchUrl.searchParams.set('srlimit', '1');
  searchUrl.searchParams.set('srprop', 'snippet');
  searchUrl.searchParams.set('format', 'json');
  searchUrl.searchParams.set('origin', '*');
  
  try {
    const res = await fetch(searchUrl.toString(), {
      headers: { 'User-Agent': 'VOYGE/1.0 (voyge.app)' },
      signal: AbortSignal.timeout(3000)
    });
    const data = await res.json();
    
    if (!data.query.search.length) return { verified: false };
    
    const title = data.query.search[0].title;
    const coordUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=coordinates&format=json&origin=*`;
    
    const coordRes = await fetch(coordUrl, {
      headers: { 'User-Agent': 'VOYGE/1.0 (voyge.app)' },
      signal: AbortSignal.timeout(3000)
    });
    const coordData = await coordRes.json();
    const page = Object.values(coordData.query.pages)[0] as any;
    const coords = page?.coordinates?.[0];
    
    return {
      verified: true,
      coordinates: coords ? [coords.lon, coords.lat] : undefined,
      wikiUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`
    };
  } catch {
    return null;
  }
}
```

---

### 12.2 Google Knowledge Graph Verification (Drop-in)

```typescript
// Add to geo.ts

export async function verifyWithKnowledgeGraph(
  placeName: string,
  contextHint?: string
): Promise<{ verified: boolean; canonicalName?: string; types?: string[]; description?: string } | null> {
  
  const kgKey = process.env.GOOGLE_KG_KEY;
  if (!kgKey) return null;
  
  const query = contextHint ? `${placeName} ${contextHint}` : placeName;
  const url = `https://kgsearch.googleapis.com/v1/entities:search?query=${encodeURIComponent(query)}&key=${kgKey}&types=Place,TouristAttraction,NaturalPlace,LandmarksOrHistoricalBuildings&limit=3`;
  
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    const best = data.itemListElement?.[0]?.result;
    
    if (!best) return { verified: false };
    
    const types: string[] = best['@type'] || [];
    const isPlace = types.some(t => 
      ['Place', 'TouristAttraction', 'NaturalPlace', 'Park', 'Mountain', 'LandmarksOrHistoricalBuildings'].includes(t)
    );
    
    return {
      verified: isPlace,
      canonicalName: best.name,
      types,
      description: best.description
    };
  } catch {
    return null;
  }
}
```

---

### 12.3 GeoNames Natural Feature Search (Drop-in)

```typescript
// Add to geo.ts — for natural features (rivers, mountains, lakes)

export async function searchNaturalFeature(
  name: string,
  featureClass: 'H' | 'T' | 'L',  // H=water, T=terrain, L=parks
  countryCode?: string
): Promise<GeoResult | null> {
  
  const geonamesUser = process.env.GEONAMES_USERNAME;
  if (!geonamesUser) return null;
  
  const params = new URLSearchParams({
    q: name,
    featureClass,
    maxRows: '3',
    type: 'json',
    username: geonamesUser,
  });
  
  if (countryCode) params.set('country', countryCode.toUpperCase());
  
  try {
    const res = await fetch(`http://api.geonames.org/searchJSON?${params}`, {
      signal: AbortSignal.timeout(4000)
    });
    const data = await res.json();
    const best = data.geonames?.[0];
    
    if (!best) return null;
    
    return {
      coordinates: [parseFloat(best.lng), parseFloat(best.lat)],
      full_address: `${best.name}, ${best.adminName1 || ''}, ${best.countryName}`.replace(/,\s*,/, ','),
      mapbox_id: null,
      country: best.countryName || '',
      city: best.adminName1 || best.name,
      confidence: 'approximate',
      source: 'geonames'
    };
  } catch {
    return null;
  }
}
```

---

### 12.4 Pin Emoji Extractor (Drop-in)

```typescript
// Add to geo.ts or scrapers.ts

export function extractPinEmojiLocation(text: string): string | null {
  const PIN_PATTERNS = [
    /📍\s*([A-Za-z][A-Za-z\s,'.'-]{2,60}?)(?:\n|$|#|@|🌊|🏔|🌲|✨|🔥)/,
    /📌\s*([A-Za-z][A-Za-z\s,'.'-]{2,60}?)(?:\n|$|#|@)/,
    /🗺️?\s*([A-Za-z][A-Za-z\s,'.'-]{2,60}?)(?:\n|$|#|@)/,
    /📺\s*([A-Za-z][A-Za-z\s,'.'-]{2,60}?)(?:\n|$|#|@)/,
    /📍([^#\n@]{3,60})/,
  ];
  
  for (const pattern of PIN_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim().replace(/[,\s]+$/, '');
      if (candidate.length >= 3 && candidate.split(' ').length <= 6) {
        return candidate;
      }
    }
  }
  return null;
}
```

---

### 12.5 HERE Geocoding Fallback (Drop-in)

```typescript
// Add to geo.ts — use as fallback when Mapbox fails

export async function geocodeWithHERE(
  query: string,
  countryCode?: string
): Promise<GeoResult | null> {
  
  const hereKey = process.env.HERE_API_KEY;
  if (!hereKey) return null;
  
  const params = new URLSearchParams({
    q: query,
    apiKey: hereKey,
    limit: '3',
    lang: 'en',
  });
  
  if (countryCode) params.set('in', `countryCode:${countryCode.toUpperCase()}`);
  
  try {
    const res = await fetch(`https://geocode.search.hereapi.com/v1/geocode?${params}`, {
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    const best = data.items?.[0];
    
    if (!best) return null;
    
    const pos = best.position;
    return {
      coordinates: [pos.lng, pos.lat],
      full_address: best.address?.label || query,
      mapbox_id: null,
      country: best.address?.countryName || '',
      city: best.address?.city || best.address?.county || '',
      confidence: best.resultType === 'place' ? 'approximate' : 'exact',
      source: 'here_geocoding'
    };
  } catch {
    return null;
  }
}
```

---

*End of VOYGE Location Extraction Research Guide*

*This document should be treated as living documentation — update it as APIs evolve, free tiers change, and new signals are discovered.*