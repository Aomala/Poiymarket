// ============================================================
// Research Agent — two-stage token-optimised pipeline
//
// Stage 1: Single Haiku call batch-classifies all predictions as
//          ultra_short (crypto speculation) or not — ~150 tokens total
//          regardless of how many predictions are in the batch.
//
// Stage 2: Sonnet + web_search runs only for survivors, with:
//          - System prompt caching (10% cost on cache reads)
//          - Trimmed user prompt (only what web search needs)
//          - max_tokens 1200 (response is ~600-800 tokens)
//          - Sources capped at 3
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { TradePrediction, AgentResearch } from "../types.js";
import { getDirectionLabel } from "../utils.js";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    if (!config.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY required for research agent");
    }
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

// ─── Stage 1: Haiku batch classifier ─────────────────────────────────────────
// One call for all predictions. Identifies crypto price speculation so we never
// burn a Sonnet+web_search call on something that gets immediately discarded.

const CLASSIFY_SYSTEM = `You classify prediction markets. For each, decide if it is "ultra_short" (crypto/asset price direction bet: "will BTC be up today?", "will ETH be above $X?", intraday price speculation) or "ok" (any real-world event market).
Return ONLY a JSON array: [{"i":<index>,"t":"ultra_short"|"ok"}]`;

async function batchClassifyHorizons(
  predictions: TradePrediction[]
): Promise<Set<string>> {
  const anthropic = getClient();

  const lines = predictions.map((p, i) => {
    const endDate = p.overlappingTrade.market.endDate
      ? new Date(p.overlappingTrade.market.endDate).toLocaleDateString()
      : "unknown";
    return `[${i}] "${p.overlappingTrade.market.question}" | ends: ${endDate}`;
  });

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: CLASSIFY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Classify:\n${lines.join("\n")}\n\nJSON only.`,
        },
      ],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");

    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return new Set();

    const parsed: Array<{ i: number; t: string }> = JSON.parse(match[0]);
    const ultraShortIds = new Set<string>();
    for (const item of parsed) {
      if (item.t === "ultra_short" && predictions[item.i]) {
        ultraShortIds.add(predictions[item.i]!.id);
      }
    }

    console.log(
      `[agent] Haiku pre-filter: ${ultraShortIds.size}/${predictions.length} ultra_short (discarded before Sonnet)`
    );
    return ultraShortIds;
  } catch (err) {
    // Fail open — Sonnet will classify during research if Haiku fails
    console.warn("[agent] Haiku classification failed, falling back to Sonnet for all:", err);
    return new Set();
  }
}

// ─── Stage 2: Sonnet + web_search with caching ───────────────────────────────
// System prompt is identical every call — cached after first use (5-min TTL).
// ultra_short is excluded here; only short_term/mid_term/long_term defined.

const RESEARCH_SYSTEM_PROMPT = `You are a prediction market research analyst with real-time web search access.

For the trade given:
1. Search for current news, data, and expert opinions.
2. Classify trade horizon: "short_term" (< 48h, event-driven), "mid_term" (2 days–3 months), or "long_term" (> 3 months).
3. Score confidence (0–100) and give a recommendation.
4. Identify up to 2 qualifying and 2 disqualifying factors.
5. Cite up to 3 sources.

Target: 80%+ hit rate. Be decisive.

Return ONLY valid JSON:
{"tradeHorizon":"<short_term|mid_term|long_term>","confidenceScore":<0-100>,"recommendation":"<strong_buy|buy|hold|avoid|strong_avoid>","rationale":"<3-4 sentences>","qualifyingFactors":["<factor>"],"disqualifyingFactors":["<factor>"],"sources":[{"title":"","url":"","summary":"","sentiment":"<bullish|bearish|neutral>","relevanceScore":<0-100>}]}`;

async function researchPrediction(
  prediction: TradePrediction
): Promise<AgentResearch> {
  const anthropic = getClient();
  const trade = prediction.overlappingTrade;

  const endDate = trade.market.endDate
    ? new Date(trade.market.endDate).toLocaleDateString()
    : "Unknown";

  // Trimmed to only what Claude actually needs for web research.
  // Internal metrics (avg entry, hedge ratio, volume, liquidity, description)
  // removed — they don't help web search and cost tokens.
  const userPrompt = `Market: "${trade.market.question}"
Resolves: ${endDate}
Betting: ${prediction.direction} — "${getDirectionLabel(trade.market, prediction.direction)}"
Implied probability: ${(trade.currentPrice * 100).toFixed(1)}% | ${trade.traderCount} top traders aligned

Search and return JSON only.`;

  console.log(
    `[agent] Researching: "${trade.market.question.slice(0, 60)}" (${prediction.direction})`
  );

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      system: [
        {
          type: "text",
          text: RESEARCH_SYSTEM_PROMPT,
          // Cached after first call — subsequent reads cost 10% of normal price
          cache_control: { type: "ephemeral" },
        },
      ] as any,
      tools: [{ type: "web_search_20250305" as any, name: "web_search" }],
      messages: [{ role: "user", content: userPrompt }],
    });

    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in agent response");

    const parsed = JSON.parse(jsonMatch[0]);

    const research: AgentResearch = {
      predictionId: prediction.id,
      tradeHorizon: parsed.tradeHorizon ?? "mid_term",
      confidenceScore: parsed.confidenceScore ?? 50,
      rationale: parsed.rationale ?? "Unable to determine",
      recommendation: parsed.recommendation ?? "hold",
      qualifyingFactors: (parsed.qualifyingFactors ?? []).slice(0, 2),
      disqualifyingFactors: (parsed.disqualifyingFactors ?? []).slice(0, 2),
      // Cap at 3 sources — unbounded sources inflate output tokens
      sources: (parsed.sources ?? []).slice(0, 3).map((s: any) => ({
        title: s.title ?? "Unknown",
        url: s.url ?? "",
        summary: s.summary ?? "",
        sentiment: s.sentiment ?? "neutral",
        relevanceScore: s.relevanceScore ?? 50,
      })),
      completedAt: new Date(),
    };

    console.log(
      `[agent] ${research.tradeHorizon} | ${research.recommendation} | confidence: ${research.confidenceScore}%`
    );

    return research;
  } catch (err) {
    console.error(`[agent] Research failed for ${prediction.id}:`, err);
    return {
      predictionId: prediction.id,
      tradeHorizon: "mid_term" as const,
      confidenceScore: 30,
      rationale: "Research failed — defaulting to conservative stance",
      recommendation: "hold",
      qualifyingFactors: [],
      disqualifyingFactors: ["Research agent encountered an error"],
      sources: [],
      completedAt: new Date(),
    };
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function researchBatch(
  predictions: TradePrediction[]
): Promise<Map<string, AgentResearch>> {
  console.log(
    `[agent] Two-stage research for ${predictions.length} predictions...`
  );

  const results = new Map<string, AgentResearch>();

  // Stage 1: one cheap Haiku call classifies all predictions
  const ultraShortIds = await batchClassifyHorizons(predictions);

  // Immediately resolve ultra_short predictions without a Sonnet call
  for (const pred of predictions) {
    if (ultraShortIds.has(pred.id)) {
      results.set(pred.id, {
        predictionId: pred.id,
        tradeHorizon: "ultra_short",
        confidenceScore: 0,
        rationale: "Classified as ultra-short crypto price speculation — auto-disqualified.",
        recommendation: "strong_avoid",
        qualifyingFactors: [],
        disqualifyingFactors: ["Ultra-short crypto/HFT speculation"],
        sources: [],
        completedAt: new Date(),
      });
    }
  }

  // Stage 2: Sonnet + web_search for survivors (max 3 concurrent)
  const toResearch = predictions.filter((p) => !ultraShortIds.has(p.id));

  if (toResearch.length > 0) {
    console.log(
      `[agent] Running Sonnet research for ${toResearch.length} predictions...`
    );

    const batchSize = 3;
    for (let i = 0; i < toResearch.length; i += batchSize) {
      const batch = toResearch.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map((p) => researchPrediction(p))
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j]!;
        const pred = batch[j]!;
        if (result.status === "fulfilled") {
          results.set(pred.id, result.value);
        }
      }
    }
  }

  console.log(
    `[agent] Complete: ${results.size}/${predictions.length} processed (${ultraShortIds.size} discarded by Haiku pre-filter)`
  );

  return results;
}
