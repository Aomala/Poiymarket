# Module: `src/services/agent.ts`

## Responsibility

Runs real-time qualitative research using Claude + live web search to classify trade horizon, qualify or disqualify predictions, and produce a structured rationale for each signal.

## How it works

- Lazily creates Anthropic client via `getClient()`.
- Uses the `web_search_20250305` built-in tool so Claude actually fetches live internet data before forming its analysis — not training-data-only reasoning.
- System prompt instructs Claude to:
  1. Classify `tradeHorizon` as `short_term`, `mid_term`, or `long_term`.
  2. Auto-disqualify short-term/HFT-style trades (crypto price direction bets, < 48h resolution, speculative noise).
  3. Search for breaking news, expert forecasts, historical base rates, and upcoming catalysts.
  4. Return qualifying/disqualifying factors and a full rationale.
  5. Provide a confidence score and recommendation.

## Trade horizon classification

| Horizon | Definition | Policy |
|---|---|---|
| `ultra_short` | Crypto/asset price direction bets ("will BTC be up today?"), intraday price levels, HFT-style speculation with no fundamental basis | Auto-disqualify |
| `short_term` | Resolves in < 48h but event-driven (sports, news decisions, political votes, economic releases) | Scored normally |
| `mid_term` | 2 days – 3 months, event/data-driven | Scored normally |
| `long_term` | > 3 months, structural/political/economic | Scored normally |

## JSON output schema

```json
{
  "tradeHorizon": "ultra_short|short_term|mid_term|long_term",
  "confidenceScore": 0-100,
  "recommendation": "strong_buy|buy|hold|avoid|strong_avoid",
  "rationale": "3-5 sentence research summary",
  "qualifyingFactors": ["..."],
  "disqualifyingFactors": ["..."],
  "sources": [{ "title", "url", "summary", "sentiment", "relevanceScore" }]
}
```

## Response parsing

Claude may produce multiple text blocks interspersed with `web_search_tool_result` blocks. The parser collects **all** `text`-type blocks and joins them before extracting JSON via regex, ensuring search result context does not break extraction.

## Batch behavior

- `researchBatch(predictions)` processes predictions in chunks of 3 to respect API rate limits.
- Uses `Promise.allSettled` for partial success tolerance.
- Returns `Map<predictionId, AgentResearch>`.

## Failure behavior

Parsing or API errors return a conservative fallback:
- `tradeHorizon: "mid_term"`
- `confidenceScore: 30`
- `recommendation: "hold"`
- Single disqualifying factor noting research failure.

## Why it matters

This module provides the real-world information layer that confirms or vetoes trader-consensus signals, with live web search ensuring analysis reflects current events rather than stale training data.
