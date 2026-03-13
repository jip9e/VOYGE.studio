/**
 * @fileoverview Stage 5 — Tool-Calling AI Agent (Last Resort)
 *
 * This module implements the final stage of the location extraction pipeline.
 * It is invoked **only** when all previous stages (extractor, geocoder,
 * verifier, vision) have failed to produce a result with confidence ≥
 * `AI_AGENT_THRESHOLD` (0.6).
 *
 * ## Overview
 *
 * The agent is powered by **GPT-5** accessed via the
 * [GitHub Models](https://github.com/marketplace/models) endpoint, which
 * proxies requests through the Azure AI Inference REST API
 * (`https://models.inference.ai.azure.com`). Authentication uses a GitHub
 * personal access token stored in the `GITHUB_MODELS_TOKEN` environment
 * variable.
 *
 * ## Agentic Loop
 *
 * The agent runs an iterative tool-calling loop:
 *
 * 1. All available location signals are serialised into a prompt.
 * 2. The model responds with either a final JSON answer or one or more
 *    tool calls.
 * 3. Each tool call is executed server-side and the result is fed back to
 *    the model as a `tool` role message.
 * 4. Steps 2–3 repeat until the model produces a final answer or
 *    `MAX_ITERATIONS` (4) tool-call rounds have been completed.
 * 5. A hard 45-second wall-clock deadline aborts the loop if it runs over.
 *
 * ## Available Tools
 *
 * | Tool name              | Description                                                  |
 * |------------------------|--------------------------------------------------------------|
 * `search_place`           | Geocode any place name via Mapbox SearchBox. Returns GPS     |
 *                          | coordinates, full address, city, and country.                |
 * `verify_place`           | Confirm a place exists via Wikipedia and retrieve its        |
 *                          | authoritative coordinates + article extract.                 |
 * `search_natural_feature` | Find natural geographic features (rivers, waterfalls,        |
 *                          | lakes, mountains) within a named region via Overpass OSM.   |
 * `reverse_geocode`        | Reverse-geocode a [lng, lat] coordinate pair via Mapbox to   |
 *                          | find nearby POIs and the containing address.                 |
 *
 * ## Agent Strategy
 *
 * The system prompt instructs the agent to:
 * 1. Analyse all signals holistically (creator comments > native tags >
 *    captions > hashtags > bio).
 * 2. Form a best hypothesis and immediately call `search_place`.
 * 3. Use `verify_place` only to disambiguate between 2+ plausible candidates.
 * 4. Use `search_natural_feature` for rivers, waterfalls, canyons, etc.
 * 5. After ≤ 2 tool-call rounds, commit to the best answer even if uncertain.
 * 6. Output a strictly-typed JSON object when done (never stream partial JSON).
 *
 * ## Output Format
 *
 * The agent must respond with a JSON object matching `AIAgentResult`:
 * ```json
 * {
 *   "name": "Horseshoe Bend",
 *   "city": "Page",
 *   "country": "United States",
 *   "coordinates": [-111.5100, 36.8791],
 *   "full_address": "Horseshoe Bend, Page, Arizona, United States",
 *   "confidence": 0.87,
 *   "category": "View",
 *   "vibe": "dramatic canyon scenic",
 *   "description": "Iconic 270° meander of the Colorado River near Page, AZ."
 * }
 * ```
 *
 * ## Invocation Conditions
 *
 * - Called by `pipeline.ts` when `best.confidence < AI_AGENT_THRESHOLD` (0.60).
 * - Skipped entirely if `GITHUB_MODELS_TOKEN` is not set.
 * - Results below `RETURN_THRESHOLD` (0.40) from the agent may still be
 *   returned but labelled `"low"` confidence.
 *
 * ## Exported Symbols
 *
 * - `runAIAgent(signals)` — Main entry point; returns `AIAgentResult | null`.
 * - `AIAgentResult`        — The structured result type returned by the agent.
 *
 * @module location/ai-agent
 */

// ─── Stage 5: AI Agent with Tool-Calling ─────────────────────────────────────
// Last-resort location extractor using GPT-5 via Azure AI Inference SDK.
// Runs an agentic loop where the AI can call geocoding / verification tools.
// Only invoked when stages 1–4 yield confidence < 0.6.

import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import type { LocationSignals } from "./extractor";
import type { GeocoderResult } from "./geocoder";
import type { VerificationResult } from "./verifier";

// ─── Client ───────────────────────────────────────────────────────────────────

function getClient() {
  const token = process.env.GITHUB_MODELS_TOKEN ?? "";
  return ModelClient(
    "https://models.inference.ai.azure.com",
    new AzureKeyCredential(token),
  );
}

// ─── Result interface ─────────────────────────────────────────────────────────

export interface AIAgentResult {
  name: string;
  city: string;
  country: string;
  coordinates: [number, number];
  full_address: string;
  mapbox_id: string | null;
  confidence: number;
  source_chain: string[];
  category?: string;
  vibe?: string;
  description?: string;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const tools = [
  {
    type: "function" as const,
    function: {
      name: "search_place",
      description:
        "Search for a place name using Mapbox geocoding. Returns coordinates and address.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Place name to search, e.g. 'McKenzie River Oregon'",
          },
          country_hint: {
            type: "string",
            description: "Optional 2-letter country code to bias results",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "verify_place",
      description:
        "Verify a place name exists using Wikipedia and get its GPS coordinates if available.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Place name to verify",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_in_region",
      description:
        "Search for a natural feature (river, waterfall, lake, mountain) in a specific region using OpenStreetMap.",
      parameters: {
        type: "object",
        properties: {
          feature_type: {
            type: "string",
            enum: [
              "river",
              "waterfall",
              "lake",
              "mountain",
              "beach",
              "trail",
              "park",
            ],
          },
          name_hint: {
            type: "string",
            description: "Partial or full name of the feature",
          },
          region: {
            type: "string",
            description: "Region/state/country to search within",
          },
        },
        required: ["feature_type", "region"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_nearby",
      description:
        "Find places near given coordinates. Use when you have approximate coords but need the specific POI name.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lng: { type: "number" },
          radius_km: {
            type: "number",
            default: 5,
          },
          type: {
            type: "string",
            description: "Type of place to search for",
          },
        },
        required: ["lat", "lng"],
      },
    },
  },
];

// ─── Tool executor ────────────────────────────────────────────────────────────

interface ToolCallArgs {
  search_place: { query: string; country_hint?: string };
  verify_place: { name: string };
  search_in_region: {
    feature_type: string;
    name_hint?: string;
    region: string;
  };
  search_nearby: {
    lat: number;
    lng: number;
    radius_km?: number;
    type?: string;
  };
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  console.log(`[AIAgent] Executing tool: ${name}`, JSON.stringify(args));

  try {
    if (name === "search_place") {
      const { query, country_hint } = args as ToolCallArgs["search_place"];
      const { geocodePlace } = await import("./geocoder");
      const result = await geocodePlace(query, {
        countryHint: country_hint,
      });
      if (!result) {
        return JSON.stringify({ error: "No geocoding result found", query });
      }
      return JSON.stringify({
        found: true,
        coordinates: result.coordinates,
        full_address: result.full_address,
        country: result.country,
        city: result.city,
        confidence: result.confidence,
        source: result.source,
      });
    }

    if (name === "verify_place") {
      const { name: placeName } = args as ToolCallArgs["verify_place"];
      const { verifyPlace } = await import("./verifier");
      const result: VerificationResult = (await Promise.race([
        verifyPlace(placeName),
        new Promise<VerificationResult>((_, reject) =>
          setTimeout(() => reject(new Error("verify_place timeout")), 8000),
        ),
      ])) as VerificationResult;
      return JSON.stringify({
        verified: result.verified,
        confidence: result.confidence,
        coordinates: result.wikiCoords ?? null,
        wiki_title: result.wikiTitle ?? null,
        description: result.wikiExtract ?? result.kgDescription ?? null,
        types: result.kgTypes ?? [],
      });
    }

    if (name === "search_in_region") {
      const { feature_type, name_hint, region } =
        args as ToolCallArgs["search_in_region"];

      // Build a natural language query and run through geocoder cascade
      const query = name_hint
        ? `${name_hint} ${feature_type} ${region}`
        : `${feature_type} in ${region}`;

      const { geocodePlace } = await import("./geocoder");
      const result: GeocoderResult | null = await geocodePlace(query, {
        regionHint: region,
        isNaturalFeature: true,
      });

      if (!result) {
        // Fall back to Nominatim directly for natural features
        return JSON.stringify({
          error: "No result found for natural feature",
          query,
          region,
          feature_type,
        });
      }

      return JSON.stringify({
        found: true,
        name: name_hint ?? feature_type,
        coordinates: result.coordinates,
        full_address: result.full_address,
        country: result.country,
        city: result.city,
        confidence: result.confidence,
        source: result.source,
      });
    }

    if (name === "search_nearby") {
      const {
        lat,
        lng,
        radius_km = 5,
        type,
      } = args as ToolCallArgs["search_nearby"];

      // Use Nominatim reverse geocode to find what's at/near these coordinates
      const params = new URLSearchParams({
        lat: lat.toString(),
        lon: lng.toString(),
        format: "json",
        zoom: "14",
        addressdetails: "1",
      });
      if (type) params.set("type", type);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);

      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?${params}`,
          {
            signal: controller.signal,
            headers: {
              "User-Agent": "VOYGE/1.0 (travel discovery app)",
              "Accept-Language": "en",
            },
          },
        );
        clearTimeout(timer);

        if (!res.ok) {
          return JSON.stringify({
            error: `Nominatim reverse geocode failed: HTTP ${res.status}`,
          });
        }

        const data = (await res.json()) as Record<string, unknown>;
        const address = (data.address as Record<string, string>) ?? {};

        return JSON.stringify({
          found: true,
          display_name: data.display_name,
          coordinates: [lng, lat],
          address: {
            place:
              address.tourism ??
              address.amenity ??
              address.leisure ??
              address.natural,
            city: address.city ?? address.town ?? address.village,
            county: address.county,
            state: address.state,
            country: address.country,
          },
          radius_km,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[AIAgent] Tool "${name}" execution error: ${msg}`);
    return JSON.stringify({ error: msg, tool: name });
  }
}

// ─── Context builder ──────────────────────────────────────────────────────────

function buildSignalContext(signals: LocationSignals): string {
  const lines: string[] = [];

  lines.push(`Platform: ${signals.platform}`);
  lines.push(`Creator: @${signals.author_username}`);

  if (signals.location_name) {
    lines.push(
      `\n🏷️  NATIVE LOCATION TAG (use as primary): "${signals.location_name}"`,
    );
    if (signals.location_lat && signals.location_lng) {
      lines.push(`   GPS: ${signals.location_lat}, ${signals.location_lng}`);
    }
  }

  if (signals._anchorLocations && signals._anchorLocations.length > 0) {
    lines.push(`\n📌 VIDEO ANCHOR LOCATIONS:`);
    signals._anchorLocations.forEach((l, i) =>
      lines.push(`  ${i + 1}. "${l}"`),
    );
  }

  if (signals._creatorComments && signals._creatorComments.length > 0) {
    lines.push(
      `\n🎯 CREATOR'S OWN COMMENTS (they filmed this — highest trust):`,
    );
    signals._creatorComments
      .slice(0, 5)
      .forEach((c, i) => lines.push(`  ${i + 1}. "${c.substring(0, 200)}"`));
  }

  if (signals.caption) {
    lines.push(`\n📝 Caption:\n"${signals.caption.substring(0, 600)}"`);
  }

  if (signals.hashtags.length > 0) {
    lines.push(
      `\n🔖 Hashtags: ${signals.hashtags
        .slice(0, 30)
        .map((h) => `#${h}`)
        .join(" ")}`,
    );
  }

  if (signals.user_bio) {
    lines.push(`\nCreator bio: "${signals.user_bio.substring(0, 300)}"`);
  }

  if (signals.top_comments.length > 0) {
    const locationAnswerPatterns = [
      /(?:it[''']?s?|this\s+is|that[''']?s?|we[''']?re\s+(?:at|in))\s+/i,
      /(?:located?\s+(?:at|in))/i,
      /(?:filmed?\s+(?:at|in))/i,
    ];
    const locationQuestionPatterns = [
      /where\s+(is|was|are)\s+(this|that|here|you|it)/i,
      /what\s+(place|location|country|city|spot)/i,
      /which\s+(country|city|place)/i,
      /location\?/i,
    ];

    const creatorSet = new Set(signals._creatorComments ?? []);
    const nonCreator = signals.top_comments.filter((c) => !creatorSet.has(c));
    const answers = nonCreator.filter((c) =>
      locationAnswerPatterns.some((p) => p.test(c)),
    );
    const questions = nonCreator.filter((c) =>
      locationQuestionPatterns.some((p) => p.test(c)),
    );
    const neutral = nonCreator.filter(
      (c) => !answers.includes(c) && !questions.includes(c),
    );

    if (answers.length > 0) {
      lines.push(`\n💬 LOCATION-ANSWER COMMENTS (viewers naming a place):`);
      answers
        .slice(0, 6)
        .forEach((c, i) => lines.push(`  ${i + 1}. "${c.substring(0, 180)}"`));
    }
    if (questions.length > 0) {
      lines.push(`\n❓ QUESTIONS (do NOT use as location evidence):`);
      questions
        .slice(0, 3)
        .forEach((c, i) => lines.push(`  ${i + 1}. "${c.substring(0, 120)}"`));
    }
    if (neutral.length > 0 && answers.length === 0) {
      lines.push(`\n💬 Other viewer comments:`);
      neutral
        .slice(0, 5)
        .forEach((c, i) => lines.push(`  ${i + 1}. "${c.substring(0, 160)}"`));
    }
  }

  return lines.join("\n");
}

// ─── Message types (minimal subset we need) ───────────────────────────────────

interface SystemMessage {
  role: "system";
  content: string;
}

interface UserMessage {
  role: "user";
  content: string;
}

interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

interface ToolMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

// ─── Main AI agent ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an elite travel location detective for VOYGE — a travel discovery app.

Your job: Given signals from a social media post, identify the EXACT real-world location shown.

You have access to tools:
- search_place: Geocode any place name via Mapbox
- verify_place: Confirm a place exists via Wikipedia and get GPS coords
- search_in_region: Find natural features (river/lake/waterfall/mountain) in a region via OSM
- search_nearby: Reverse-geocode coordinates to find nearby POIs

Strategy:
1. Analyse ALL signals holistically — creator comments > native tags > captions > hashtags > bio
2. Form your best hypothesis about the location
3. Use search_place to geocode your hypothesis immediately — this is your primary tool
4. Only use verify_place if you need to disambiguate between 2+ candidates
5. Use search_in_region for natural features (rivers, waterfalls, lakes) in a known region
6. Triangulate: multiple signals pointing to same region = higher confidence
7. After 2 tool calls, commit to your best answer even if not 100% certain

When done, output ONLY a valid JSON object with this exact structure:
{
  "name": "Specific place name",
  "city": "City or region",
  "country": "Full country name",
  "coordinates": [longitude, latitude],
  "full_address": "Full formatted address",
  "confidence": 0.0-1.0,
  "category": "One of: Food | Stay | View | Activity | Shopping | Museum | Park | Attraction | Beach | Nightlife",
  "vibe": "Exactly 3 space-separated descriptive words",
  "description": "One punchy sentence under 90 chars"
}

Rules:
- coordinates MUST be [longitude, latitude] (lng first)
- If truly unknown, set confidence below 0.4
- Never hallucinate coordinates — always use tool results
- Max 4 tool call rounds before giving your best answer`;

/**
 * Run the AI agent loop.
 *
 * @param signals - All available location signals from the scraper
 * @returns AIAgentResult or null if the AI could not determine a location
 */
export async function runAIAgent(
  signals: LocationSignals,
): Promise<AIAgentResult | null> {
  const tokenEnv = process.env.GITHUB_MODELS_TOKEN;
  if (!tokenEnv) {
    console.warn("[AIAgent] GITHUB_MODELS_TOKEN not set — skipping AI agent");
    return null;
  }

  console.log("[AIAgent] Starting agentic location extraction…");

  const client = getClient();
  const context = buildSignalContext(signals);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: `Identify the location from these social media signals:\n\n${context}\n\nUse your tools to find the exact location, then output the JSON result.`,
    },
  ];

  const MAX_ITERATIONS = 4;
  const sourceChain: string[] = ["ai_agent"];
  const agentDeadline = Date.now() + 45_000; // 45 seconds total

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (Date.now() > agentDeadline) {
      console.warn(`[AIAgent] Deadline exceeded — stopping loop`);
      break;
    }
    console.log(`[AIAgent] Iteration ${iteration + 1}/${MAX_ITERATIONS}`);

    let response: Awaited<
      ReturnType<ReturnType<typeof getClient>["path"]>["post"]
    >;

    try {
      response = await client.path("/chat/completions").post({
        body: {
          messages: messages as Parameters<typeof client.path>[0] extends never
            ? never
            : never,
          model: "gpt-5",
          tools,
          tool_choice: iteration < MAX_ITERATIONS - 1 ? "auto" : "none",
          response_format:
            iteration === MAX_ITERATIONS - 1
              ? { type: "json_object" }
              : undefined,
        } as Record<string, unknown>,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `[AIAgent] API call failed on iteration ${iteration + 1}: ${msg}`,
      );
      break;
    }

    if (isUnexpected(response)) {
      console.error("[AIAgent] Unexpected API response:", response.body);
      break;
    }

    // @ts-ignore — SDK types do not precisely match runtime shape
    const choice = response.body?.choices?.[0];
    if (!choice) {
      console.warn("[AIAgent] No choices in response");
      break;
    }

    const message = choice.message as AssistantMessage;

    // ── Handle tool calls ────────────────────────────────────────────────────
    if (
      message.tool_calls &&
      message.tool_calls.length > 0 &&
      choice.finish_reason !== "stop"
    ) {
      // Add assistant message with tool calls to history
      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });

      // Execute each tool call and collect results
      for (const toolCall of message.tool_calls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(toolCall.function.arguments) as Record<
            string,
            unknown
          >;
        } catch {
          console.warn(
            `[AIAgent] Failed to parse tool args for ${toolCall.function.name}: ${toolCall.function.arguments}`,
          );
        }

        const toolResult = await executeTool(
          toolCall.function.name,
          parsedArgs,
        );
        sourceChain.push(`tool:${toolCall.function.name}`);

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResult,
        });

        console.log(
          `[AIAgent] Tool "${toolCall.function.name}" result: ${toolResult.substring(0, 200)}`,
        );
      }

      // Continue the loop — AI will process tool results in next iteration
      continue;
    }

    // ── Handle final answer ──────────────────────────────────────────────────
    if (choice.finish_reason === "stop" || !message.tool_calls?.length) {
      const content = message.content;
      if (!content) {
        console.warn("[AIAgent] Empty final response");
        break;
      }

      console.log(`[AIAgent] Final response: ${content.substring(0, 400)}`);

      // Extract JSON from the response (handle cases where AI wraps in markdown)
      let jsonStr = content.trim();

      // Strip markdown code fences if present
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch?.[1]) {
        jsonStr = fenceMatch[1].trim();
      }

      // Find JSON object boundaries
      const start = jsonStr.indexOf("{");
      const end = jsonStr.lastIndexOf("}");
      if (start !== -1 && end !== -1) {
        jsonStr = jsonStr.substring(start, end + 1);
      }

      try {
        const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

        // Validate required fields
        const name = (parsed.name as string) ?? "";
        const city = (parsed.city as string) ?? "";
        const country = (parsed.country as string) ?? "";
        const coords = parsed.coordinates as [number, number] | undefined;
        const confidence =
          typeof parsed.confidence === "number" ? parsed.confidence : 0.5;

        if (!name || !coords || !Array.isArray(coords) || coords.length < 2) {
          console.warn(
            "[AIAgent] AI response missing required fields:",
            parsed,
          );
          return null;
        }

        const [lng, lat] = coords;
        if (typeof lng !== "number" || typeof lat !== "number") {
          console.warn("[AIAgent] AI returned invalid coordinates:", coords);
          return null;
        }

        console.log(
          `[AIAgent] ✅ Result: "${name}, ${city}, ${country}" @ [${lat.toFixed(4)}, ${lng.toFixed(4)}] conf=${confidence.toFixed(2)}`,
        );

        return {
          name,
          city,
          country,
          coordinates: [lng, lat],
          full_address:
            (parsed.full_address as string) ?? `${name}, ${city}, ${country}`,
          mapbox_id: null,
          confidence,
          source_chain: sourceChain,
          category: (parsed.category as string) ?? undefined,
          vibe: (parsed.vibe as string) ?? undefined,
          description: (parsed.description as string) ?? undefined,
        };
      } catch (parseError: unknown) {
        const msg =
          parseError instanceof Error ? parseError.message : String(parseError);
        console.error(
          `[AIAgent] Failed to parse final JSON: ${msg}\nRaw: ${jsonStr.substring(0, 500)}`,
        );
        return null;
      }
    }

    // Unexpected finish reason — break the loop
    console.warn(`[AIAgent] Unexpected finish_reason: ${choice.finish_reason}`);
    break;
  }

  console.warn("[AIAgent] Agent loop exhausted without a final answer");
  return null;
}
