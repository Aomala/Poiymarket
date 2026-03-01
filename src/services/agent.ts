// ============================================================
// Research Agent — uses Claude + web search to qualify predictions
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import {
  TradePrediction,
  AgentResearch,
} from "../types.js";
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

const RESEARCH_SYSTEM_PROMPT = `You are a prediction market research analyst with access to real-time web search.

For each trade you are given, you must:
1. Search the internet for current news, data, and expert opinions on this topic.
2. Classify the trade horizon — use exactly one of these four values:
   - "ultra_short": Crypto or asset PRICE DIRECTION bets ("will BTC be up today?", "will ETH be above $X?"), intraday speculative price movements, or HFT-style noise with no fundamental informational basis. AUTO-DISQUALIFY these — they are pure speculation.
   - "short_term": Resolves in < 48 hours but is driven by a real-world event (sports outcome, news decision, political vote, economic data release). These are valid — score them normally.
   - "mid_term": Resolves in 2 days – 3 months, driven by real-world events or data releases.
   - "long_term": Resolves in > 3 months, structural/political/economic event.
3. Identify qualifying factors (reasons the trade succeeds).
4. Identify disqualifying factors (reasons the trade fails).
5. Provide a confidence score (0–100).
6. Give a clear recommendation.

Be rigorous — we target 80%+ hit rate. Only qualify high-conviction trades with real informational edge.

Respond ONLY in valid JSON (no markdown, no code blocks):
{
  "tradeHorizon": "<ultra_short|short_term|mid_term|long_term>",
  "confidenceScore": <0-100>,
  "recommendation": "<strong_buy|buy|hold|avoid|strong_avoid>",
  "rationale": "<3-5 sentence summary of your research findings and reasoning>",
  "qualifyingFactors": ["<factor>"],
  "disqualifyingFactors": ["<factor>"],
  "sources": [
    {
      "title": "<source title>",
      "url": "<url>",
      "summary": "<what this source says>",
      "sentiment": "<bullish|bearish|neutral>",
      "relevanceScore": <0-100>
    }
  ]
}`;

export async function researchPrediction(
  prediction: TradePrediction
): Promise<AgentResearch> {
  const anthropic = getClient();
  const trade = prediction.overlappingTrade;

  const endDate = trade.market.endDate
    ? new Date(trade.market.endDate).toLocaleDateString()
    : "Unknown";

  const userPrompt = `Research this prediction market trade using web search:

**Market Question:** ${trade.market.question}
**Category:** ${trade.market.category || "Unknown"}
**Description:** ${trade.market.description || "N/A"}
**Market Resolves:** ${endDate}

**Trade Direction:** ${prediction.direction} — "${getDirectionLabel(trade.market, prediction.direction)}"
**Current Price:** $${trade.currentPrice.toFixed(3)} (${(trade.currentPrice * 100).toFixed(1)}% implied probability)
**Avg Entry Price of Top Traders:** $${trade.avgEntryPrice.toFixed(3)}
**Number of Top Traders on this side:** ${trade.traderCount}
**Hedge Ratio:** ${(trade.hedgeRatio * 100).toFixed(1)}%
**Market Volume:** $${parseInt(trade.market.volume || "0").toLocaleString()}
**Market Liquidity:** $${parseInt(trade.market.liquidity || "0").toLocaleString()}

First determine the trade horizon. If this is a crypto or asset price direction bet ("will BTC/ETH/SOL be up or down?", intraday price levels) or pure HFT-style speculation with no fundamental basis, classify it as "ultra_short" and set recommendation to "avoid". All other trades — including legitimate short-term event outcomes resolving in < 48 hours — should be classified as "short_term", "mid_term", or "long_term" and scored on their merits.

Otherwise, search for:
- Breaking news and recent developments on this topic
- Expert forecasts and probability estimates
- Historical base rates for similar events
- Upcoming catalysts, deadlines, or decision points
- Key risks and counterarguments

Be decisive. Return only the JSON object.`;

  console.log(
    `[agent] Researching: "${trade.market.question.slice(0, 60)}" (${prediction.direction})`
  );

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 3000,
      tools: [
        {
          type: "web_search_20250305" as any,
          name: "web_search",
        },
      ],
      system: RESEARCH_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });

    // Collect all text blocks — there may be multiple after web search tool use
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text)
      .join("\n");

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in agent response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const research: AgentResearch = {
      predictionId: prediction.id,
      tradeHorizon: parsed.tradeHorizon ?? "mid_term",
      confidenceScore: parsed.confidenceScore ?? 50,
      rationale: parsed.rationale ?? "Unable to determine",
      recommendation: parsed.recommendation ?? "hold",
      qualifyingFactors: parsed.qualifyingFactors ?? [],
      disqualifyingFactors: parsed.disqualifyingFactors ?? [],
      sources: (parsed.sources ?? []).map((s: any) => ({
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

export async function researchBatch(
  predictions: TradePrediction[]
): Promise<Map<string, AgentResearch>> {
  console.log(
    `[agent] Starting batch research for ${predictions.length} predictions...`
  );

  const results = new Map<string, AgentResearch>();

  // Run research jobs concurrently (max 3 at a time to respect rate limits)
  const batchSize = 3;
  for (let i = 0; i < predictions.length; i += batchSize) {
    const batch = predictions.slice(i, i + batchSize);
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

  console.log(
    `[agent] Batch research complete: ${results.size}/${predictions.length} succeeded`
  );

  return results;
}
