# Module: `src/services/tracker.ts`

## Responsibility

Finds overlapping market positions among tracked traders and converts them into candidate signals. Only surfaces positions for markets where traders have been **active in the last 24 hours**, preventing stale weeks-old positions from generating signals.

## Recency filter

Before processing any trader's positions, a `Set<conditionId>` is built from that trader's `recentTrades` filtered to the last 24 hours (`Date.now() - 24 * 60 * 60 * 1000`). Traders with zero recent trades are skipped entirely. Only positions whose `conditionId` appears in the recent set are passed into overlap detection.

This ensures every signal detected represents a trade that a top trader opened or added to **today**, not a position they've been holding for weeks.

## Core algorithm

1. For each trader, compute `recentConditionIds` — markets active in last 24h.
2. Skip trader entirely if no recent activity.
3. Iterate trader's positions; skip any market not in `recentConditionIds`.
4. Group qualifying positions by `conditionId`.
5. Split participants by outcome direction (`Yes` vs `No`).
6. Determine majority side as signal direction.
7. Compute `hedgeRatio` from minority side participation.
8. Emit `OverlappingTrade` objects sorted by trader count.

## Hedging logic

- `isHedged = hedgeRatio > MAX_HEDGE_RATIO`
- Flagged here; removed in the analyzer stage.

## Market object construction

Creates a lightweight `GammaMarket` stub from position data (question, slug, one token, hardcoded `active: true`). This stub is replaced with authoritative Gamma API data in the analyzer enrichment step.

## Why it matters

This module is the signal detector: it turns raw trader positions into structured, freshness-gated consensus opportunities.
