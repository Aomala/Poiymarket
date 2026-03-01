# Module: `src/services/sniper.ts`

## Responsibility

Provides real-time entry price optimization, post-research qualification handling (including short-term trade disqualification), budget reallocation, and dashboard stats state.

## Entry optimization (`optimizeEntryPoints`)

For each non-disqualified prediction:

1. Finds matching token by direction from `market.tokens` (populated with real Gamma data in the analyzer).
2. Calls `getMidpoint(token_id)` against the CLOB — this is the exact price Polymarket's UI displays.
3. Sets `pred.overlappingTrade.currentPrice = midpoint` so all downstream code uses the same live number.
4. Sets `pred.entryPrice = midpoint` (3 decimal places).
5. Sets `pred.targetPrice = min(midpoint * 1.5, 0.95)` — always relative to the live price.
6. Fallback on CLOB failure: uses `trade.currentPrice` (Gamma-updated price from this cycle). **Never falls back to `avgEntryPrice`** — that is what traders paid historically, not the current market price.
7. Recomputes `expectedReturn`.
8. Disqualifies if `expectedReturn <= 0`.

## Research application (`applyResearchResults`)

Applies AI research results to each prediction in this order:

### Step 1 — Ultra-short speculation gate
If `research.tradeHorizon === "ultra_short"`, the prediction is **immediately disqualified** before any confidence blending. This covers only crypto/asset price direction bets and HFT-style speculation with no fundamental basis. Legitimate short-term event trades (< 48h but event-driven) are classified as `short_term` and scored normally.

### Step 2 — Confidence blending (mid/long-term only)
```
finalConfidence = round(traderSignalConfidence * 0.4 + researchConfidenceScore * 0.6)
```

### Step 3 — Recommendation policy
| Recommendation | Outcome |
|---|---|
| `strong_avoid` / `avoid` | Disqualified |
| `strong_buy` / `buy` | Qualified |
| `hold` | Qualified only if `traderCount >= MIN_OVERLAP_TRADERS + 2` |

### Step 4 — Budget reallocation
Budget is redistributed among qualified predictions only, proportionally by blended confidence. Allocations below `$5` are zeroed.

## Stats subsystem

- Owns singleton `stats: DashboardStats`.
- `updateStats(partial)` merges partial updates and recomputes derived fields:
  - `allocatedBudget` — sum of qualified/active prediction allocations
  - `remainingBudget = totalBudget - allocatedBudget`
  - `hitRate = winningTrades / totalTrades * 100`
  - `avgReturnPerTrade = totalPnL / totalTrades`
- `getStats()` returns a shallow copy for rendering.

## Why it matters

This module is the execution-planning and state engine: it enforces the short-term trade filter, merges real-world research into confidence, and maintains the stats state the dashboard renders.
