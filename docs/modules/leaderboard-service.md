# Module: `src/services/leaderboard.ts`

## Responsibility

Discovers the top traders for the current week and ranks them by capital efficiency and consistency, not raw PnL alone.

## Selection pipeline

### Step 1 — Weekly leaderboard (top 50 candidates)
Fetches the top 50 traders from `data-api.polymarket.com/v1/leaderboard?timePeriod=WEEK&orderBy=PNL`. Weekly-only — monthly data is dropped to keep signals fresh and current.

### Step 2 — Profitable filter
Drops any trader with `pnl <= 0`. Only traders who actually made money this week are considered.

### Step 3 — Volume floor
Computes the **median weekly volume** across the profitable candidates. Traders below the median are dropped. This adapts to the real distribution of the leaderboard rather than using a hardcoded dollar threshold, and filters out low-stakes traders whose positions are too small to generate meaningful signals.

### Step 4 — Hydration (top 40 by PnL)
For each remaining candidate, fetches concurrently:
- `getTraderPositions(address)` — all open positions with per-position PnL
- `getTraderActivity(address)` — 100 most recent trades with timestamps

Uses `Promise.allSettled` for partial success tolerance.

### Step 5 — Activity filter
Drops traders with fewer than 5 recent trades. Confirms they are actively trading this period, not just holding one old position.

### Step 6 — Consistency ranking (`rankByConsistency`)

Each trader is scored on two equally-weighted factors:

| Factor | Weight | Description |
|---|---|---|
| **PnL efficiency** | 50% | `pnl / volume` (ROI on weekly volume), normalised 0–1 within the pool |
| **Open position win rate** | 50% | Fraction of current positions with positive PnL — proxy for trade consistency |

Normalising efficiency within the pool ensures it's comparable to win rate (0–1) regardless of absolute scale. A trader with 25% ROI on $200k volume ranks higher than one with 2.5% ROI on $2M volume.

Final list is sorted by score descending and sliced to `TOP_TRADERS_COUNT` (default: 20).

## Logging

Each selected trader is logged with: username, weekly PnL, weekly volume, ROI %, and open position win rate. Useful for verifying selection quality at a glance.

## State

- Maintains an in-memory `trackedTraders` map keyed by wallet address.
- Exposes read access through `getTrackedTraders()` and `getTrader(address)`.

## Why it matters

The quality of every downstream signal depends entirely on who is in this list. Selecting by efficiency and consistency — not just raw PnL — ensures the traders being copied have repeatable edge, not one lucky outsized bet.
