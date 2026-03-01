# Module: `src/services/polymarket.ts` (Polymarket Client)

## Responsibility

Single integration layer for Polymarket endpoints and related normalization.

## Endpoints wrapped

- **Gamma API:** active markets, market lookup.
- **Data API:** leaderboard, positions, activity.
- **CLOB API:** trades, orderbook, midpoint, price history.

## Key exported functions

- `getActiveMarkets(...)`, `getMarket(...)`
- `getTopTraders(...)` (with fallback path)
- `getTraderPositions(...)`, `getTraderActivity(...)`
- `getRecentTrades(...)`, `getTraderTrades(...)`
- `getOrderBook(...)`, `getMidpoint(...)`, `getPriceHistory(...)`

## Resilience behavior

- Shared `fetchJson(...)` throws on non-OK responses with status and URL details.
- Leaderboard has a fallback (`getTopTradersFallback`) using high-volume market trades.
- Some calls intentionally degrade to empty arrays on errors (positions/activity/trader trades).

## Why it matters

All downstream logic depends on this module for fresh market/trader signal inputs.

