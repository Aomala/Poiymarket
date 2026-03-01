# Module: `src/config.ts` and `src/types.ts`

## Responsibility

Defines runtime configuration and the domain model used by every service.

## `src/config.ts`

- Loads environment variables through `dotenv`.
- Provides typed `config: BotConfig`.
- Includes defaults for safe startup in read-only mode.
- Includes optional auth fields for future trade execution support.

## `src/types.ts`

### Polymarket API objects

- **`GammaMarket`** — full market record from Gamma API: `id`, `question`, `slug`, `conditionId`, `tokens[]` (with `token_id`, `outcome`, `price`), `volume`, `liquidity`, `startDate`, `endDate`, `closed`, `active`, `description`, `category`, `minimum_order_size`, `minimum_tick_size`, `negRisk`.
- **`TraderProfile`** — wallet address, username, PnL, volume, rank, win rate.
- **`TraderPosition`** — per-market position: `conditionId`, `tokenId`, `outcome`, `size`, `avgPrice`, `currentPrice`, `pnl`, optional `title`/`slug`/`market`.
- **`TradeRecord`** — individual trade event: `market` (conditionId), `asset_id`, `side`, `size`, `price`, `timestamp`, `owner`, `outcome`.

### Internal pipeline models

- **`TrackedTrader`** — `profile + positions + recentTrades + lastScanned`.
- **`OverlappingTrade`** — consensus signal: `conditionId`, `market` (full `GammaMarket` after Gamma enrichment), `direction`, `traders[]`, `traderCount`, `avgEntryPrice`, `currentPrice` (live from Gamma), `isHedged`, `hedgeRatio`, `detectedAt`.
- **`TradePrediction`** — actionable signal: `id`, `overlappingTrade`, `direction`, `confidence`, `entryPrice`, `targetPrice`, `expectedReturn`, `budgetAllocation`, `status`, optional `research`, `createdAt`.

### AI research model

**`AgentResearch`**:
```ts
{
  predictionId: string;
  tradeHorizon: "short_term" | "mid_term" | "long_term";
  confidenceScore: number;       // 0-100
  rationale: string;             // 3-5 sentence research summary
  qualifyingFactors: string[];
  disqualifyingFactors: string[];
  recommendation: "strong_buy" | "buy" | "hold" | "avoid" | "strong_avoid";
  sources: ResearchSource[];
  completedAt: Date;
}
```

`tradeHorizon` drives the auto-disqualification gate in the sniper service. Only `ultra_short` is disqualified — `short_term`, `mid_term`, and `long_term` are all scored normally.

**`ResearchSource`**: `url`, `title`, `summary`, `sentiment`, `relevanceScore`.

### UI state

**`DashboardStats`** — scanner counters, signal pipeline stats, budget figures, performance history, current prediction batch.

### Runtime config

**`BotConfig`** — all environment-driven parameters including Polymarket endpoints, bot thresholds, and optional Anthropic key.

## Why it matters

This module is the schema backbone: each stage in the pipeline transforms one typed object into another, and the types enforce correctness across service boundaries.
