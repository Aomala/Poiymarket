# Module: `src/services/analyzer.ts`

## Responsibility

Converts overlapping trades into ranked, live-verified predictions with confidence scores and initial budget allocation.

## Stage 1: filter, rank, and enrich (`filterAndRankTrades`) — async

### 1a. Hedging and overlap filter
- Removes hedged trades (`!o.isHedged`).
- Enforces `MIN_OVERLAP_TRADERS` minimum participant count.

### 1b. Rank by conviction
- Sorts by `traderCount` descending, then by `|avgEntryPrice - 0.5|` (stronger price conviction wins ties).

### 1c. Candidate pool
- Takes `TOP_TRADES_COUNT * 2` candidates before Gamma enrichment to compensate for markets that will be filtered as expired.

### 1d. Gamma API enrichment (concurrent)
For each candidate, calls `getMarket(conditionId)` against the Gamma API (`gamma-api.polymarket.com`):

- **Expired market filter:** if `gammaMarket.closed || !gammaMarket.active`, the trade is logged and dropped.
- **Full market replacement:** the synthetic tracker-built `GammaMarket` stub is replaced with the real Gamma object, providing:
  - Authoritative `slug` for correct `polymarket.com/event/{slug}` URLs.
  - Real `token_id`s for both YES and NO tokens (needed by sniper orderbook lookups).
  - Live `liquidity` for confidence scoring.
- **Live price update:** `trade.currentPrice` is updated to the Gamma token price for the trade direction, replacing the stale value from the positions endpoint.
- On Gamma API failure: trade is included with original stale data as fallback.

### 1e. Re-sort and slice
- Re-sorts `live` array (concurrent fetches do not preserve order).
- Returns up to `TOP_TRADES_COUNT` results.

## Stage 2: build predictions (`generatePredictions`)

For each qualified overlap:
- Generates unique prediction id.
- Computes preliminary `entryPrice` via `calculateOptimalEntry` (`min(avgEntry, currentPrice) * 0.98`). **This is overridden by the CLOB midpoint in the sniper step.**
- Computes preliminary `targetPrice` via `calculateTarget` (`min(currentPrice * 1.5, 0.95)`) — relative to today's live price, not historical avg entry.
- Computes `expectedReturn`.
- Computes initial `confidence` via `calculateInitialConfidence`.
- Initializes `status: "pending"`.

## Initial confidence scoring (`calculateInitialConfidence`)

| Factor | Points |
|---|---|
| Base | 50 |
| Each trader above `MIN_OVERLAP_TRADERS` | +5 |
| Low hedge ratio: `(1 - hedgeRatio) * 15` | 0–15 |
| Current price in actionable zone (0.2–0.8) | +10 |
| Liquidity > $100k | +10 |
| Liquidity > $50k | +5 |
| Clamp | 10–95 |

## Budget allocation

- Allocates total budget proportionally by confidence.
- Allocations below Polymarket minimum order size (`$5`) are zeroed and the prediction is disqualified.

## Why it matters

This module is the live-verification and scoring layer: it ensures every prediction passed downstream represents a real, open, liquid market with accurate pricing.
