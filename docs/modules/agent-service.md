# Module: `src/services/agent.ts`

## Responsibility

Runs real-time qualitative research using a two-stage token-optimised pipeline to classify trade horizon, qualify or disqualify predictions, and produce a structured rationale. Full Sonnet+web_search calls only run for predictions that pass the initial cheap filter.

## Two-stage pipeline

### Stage 1 — Haiku batch classifier (one call for all predictions)

A single `claude-haiku-4-5-20251001` call receives all predictions at once and classifies each as `ultra_short` or `ok`. This costs roughly 150 tokens total regardless of batch size.

- Input per prediction: question + end date (~15 tokens each)
- Output: JSON array of `{"i": index, "t": "ultra_short"|"ok"}`
- `ultra_short` predictions are immediately resolved with `recommendation: "strong_avoid"` — no Sonnet call needed
- If Haiku fails, falls back to Sonnet for all (fail-open)

### Stage 2 — Sonnet + web_search (survivors only)

`claude-sonnet-4-20250514` with `web_search_20250305` runs only for predictions not discarded by Stage 1.

**Token optimisations applied:**

| Optimisation | Saving |
|---|---|
| System prompt caching (`cache_control: ephemeral`) | Cache reads cost 10% after first call in a 5-min window |
| Trimmed user prompt | Removed description, avg entry price, hedge ratio, volume, liquidity — none help web search |
| `max_tokens: 1200` (down from 3000) | Response is ~600-800 tokens; 2200 tokens of unused capacity eliminated |
| Sources capped at 3 | Unbounded sources inflated output tokens |
| Qualifying/disqualifying factors capped at 2 each | Reduces output token count |

**Prompt caching detail:** The system prompt is passed as an array of content blocks with `cache_control: { type: "ephemeral" }`. After the first Sonnet call in a scan cycle, subsequent calls within 5 minutes read from cache at 10% of normal input token cost.

## Trade horizon classification

| Horizon | Definition | Who classifies |
|---|---|---|
| `ultra_short` | Crypto/asset price direction bets, intraday speculation, HFT noise | Haiku (Stage 1) |
| `short_term` | < 48h but event-driven (sports, news, political votes) | Sonnet (Stage 2) |
| `mid_term` | 2 days – 3 months, event/data-driven | Sonnet (Stage 2) |
| `long_term` | > 3 months, structural/political/economic | Sonnet (Stage 2) |

## Token usage estimate (5 predictions, 2 ultra_short)

| Before | After |
|---|---|
| 5 × Sonnet calls (~1400 tokens each) = ~7000 tokens | 1 Haiku call (~150) + 3 × Sonnet (~800 each) = ~2550 tokens |
| ~7000 tokens | ~2550 tokens (~64% reduction) |

## Failure behavior

- **Haiku failure**: falls back to running Sonnet for all predictions (fail-open)
- **Sonnet failure**: returns conservative fallback (`hold`, confidence 30, `mid_term`)

## Batch concurrency

Stage 2 runs Sonnet calls in chunks of 3 (`Promise.allSettled`) to respect API rate limits while maximising throughput.

## Why it matters

Using Haiku as a cheap pre-filter means the most expensive model (Sonnet+web_search) only runs on trades that have a realistic chance of being qualified, keeping costs proportional to actual signal value.
