# Polymarket Sniper Bot: End-to-End Codebase Guide

## What this system is

This repository is a **read-only signal engine** for Polymarket. It does not place trades.
Each scan cycle it:

1. Finds top-performing traders.
2. Detects markets where multiple top traders have all traded **within the last 24 hours** in the same direction.
3. Verifies each market is still **live and active** via the Gamma API.
4. Filters hedged/noisy signals.
5. Builds predictions with live entry prices, target prices, and budget.
6. Runs Claude research with **real-time web search** to classify trade horizon and qualify/disqualify each signal.
7. Auto-disqualifies short-term and HFT-style trades.
8. Prints a dashboard with full AI rationale and a prediction batch output.

Core runtime starts in `src/index.ts`.

---

## High-level architecture

- **Orchestrator:** `src/index.ts`
- **Configuration:** `src/config.ts`
- **Domain model types:** `src/types.ts`
- **Polymarket data client:** `src/services/polymarket.ts`
- **Top trader discovery:** `src/services/leaderboard.ts`
- **Overlap detection + recency filtering:** `src/services/tracker.ts`
- **Scoring, Gamma enrichment, and prediction generation:** `src/services/analyzer.ts`
- **AI research layer (with web search):** `src/services/agent.ts`
- **Entry optimization + stats state:** `src/services/sniper.ts`
- **Console presentation:** `src/dashboard.ts`
- **Question-to-direction labels:** `src/utils.ts`

---

## Runtime lifecycle (single process)

### 1) Bootstrap and config load

- `dotenv` loads environment variables in `src/config.ts`.
- `config` object is built with defaults for:
  - scan cadence (`SCAN_INTERVAL_MS`)
  - overlap thresholds (`MIN_OVERLAP_TRADERS`, `MAX_HEDGE_RATIO`)
  - portfolio budget (`BUDGET_USDC`)
  - top trader/trade limits (`TOP_TRADERS_COUNT`, `TOP_TRADES_COUNT`)
  - optional Anthropic key (`ANTHROPIC_API_KEY`)

If required env parsing fails, process throws early.

### 2) Process startup (`start()`)

In `src/index.ts`, `start()`:

- Prints a startup banner with effective config values.
- Runs one immediate scan cycle.
- Schedules periodic cycles with `setInterval`.
- Installs `SIGINT` and `SIGTERM` graceful shutdown handlers.

### 3) Scan cycle pipeline (`runScanCycle()`)

Each cycle executes the same 6-step pipeline:

#### Step 1 — `discoverTopTraders()`
Fetches the top 50 traders from the **weekly leaderboard only**. Filters to profitable traders (`pnl > 0`), then applies a volume floor (median weekly volume of the pool) to remove low-stakes traders. Hydrates remaining candidates with positions and activity, drops those with fewer than 5 recent trades, then ranks survivors by a composite score: 50% normalised PnL efficiency (ROI on volume) + 50% open-position win rate. Returns the top `TOP_TRADERS_COUNT` by this score.

#### Step 2 — `detectOverlappingTrades(traders)`
Groups trader positions by market/conditionId. **Critically, only positions for markets where the trader has made a trade in the last 24 hours are considered.** Traders with zero recent activity are skipped entirely. Infers majority side, computes hedge ratio.

#### Step 3 — `filterAndRankTrades(overlaps)` (async)
- Removes hedged trades; enforces minimum overlap count.
- Sorts by conviction (trader count, then price distance from 0.5).
- Takes up to `TOP_TRADES_COUNT * 2` candidates.
- For each candidate, calls the **Gamma API** to:
  - Verify market is still `active` and not `closed` — expired markets are dropped.
  - Replace the tracker-built synthetic market stub with real market data (correct slug, real token_ids, live liquidity).
  - Update `currentPrice` to the live Gamma token price.
- Re-sorts and returns top `TOP_TRADES_COUNT` live markets.

#### Step 4 — `generatePredictions(...)` + `optimizeEntryPoints(...)`
Creates prediction objects with initial entry/target/confidence. Sniper then refines entry prices using real-time CLOB orderbook data (using the correct token_ids from Gamma).

#### Step 5 — `researchBatch(...)` + `applyResearchResults(...)` (optional)
If Anthropic key is configured:
- Claude calls `web_search_20250305` to fetch live internet data for each prediction.
- Claude classifies `tradeHorizon`: `short_term`, `mid_term`, or `long_term`.
- **`short_term` trades are immediately disqualified** (crypto price bets, HFT noise, < 48h resolution).
- For mid/long-term trades: confidence is blended (40% trader signal + 60% AI score), recommendation applied.

If no key: all non-disqualified predictions qualify on trader signal alone (no horizon filter applies).

#### Step 6 — Output + dashboard
Logs prediction batch with full AI rationale. Re-renders console dashboard.

---

## Data flow across services

### Inputs

- **Polymarket data-api** for leaderboard, positions (all-time open), and trader activity (timestamped).
- **Polymarket Gamma API** for live market verification, authoritative slugs, real token_ids, and live prices.
- **Polymarket CLOB API** for orderbook, midpoint, and trade feeds.
- **Environment configuration** from `.env`.
- **Anthropic API** (optional) for real-time web search + qualitative signal validation.

### Intermediate objects

- `TrackedTrader` from leaderboard hydration.
- `OverlappingTrade` (24h-filtered) from tracker.
- `OverlappingTrade` (Gamma-enriched, live-priced) from analyzer.
- `TradePrediction` from analyzer + sniper stages.
- `AgentResearch` (with `tradeHorizon`) from Claude evaluation.

### Outputs

- Console logs (cycle progress, batch results, disqualification reasons).
- Dashboard stats render with full AI rationale.
- In-memory prediction/session history (`allPredictions`).

No DB, queue, or persistent storage exists in this version.

---

## Signal qualification logic

### Freshness gate (tracker)

Only positions for markets where the trader made a trade **in the last 24 hours** are processed. Ensures signals represent today's conviction, not weeks-old holdings.

### Trader-consensus signal

- Signals are based on multiple top traders aligned in one direction **today**.
- A market is considered when total recent participants on both sides reaches at least `MIN_OVERLAP_TRADERS`.
- Dominant side becomes the predicted direction.

### Hedge filtering

- `hedgeRatio = minoritySideCount / totalTraders`
- If `hedgeRatio > MAX_HEDGE_RATIO`, trade is marked hedged and filtered.

### Live market verification (analyzer — Gamma API)

Every candidate is verified against the Gamma API. Markets where `closed === true` or `active === false` are dropped. This prevents predictions on expired or resolved markets.

### Entry price accuracy

`currentPrice` is updated to the live Gamma API token price. The sniper further refines entry using real-time CLOB orderbook data with the correct `token_id` from Gamma.

### Market URL accuracy

The `slug` used to build `polymarket.com/event/{slug}` links comes directly from the Gamma API response, not the positions endpoint. These are the slugs Polymarket's frontend actually routes from.

### Trade horizon classification (AI — with web search)

Claude classifies each prediction's time horizon using real web search results:

| Horizon | Definition | Policy |
|---|---|---|
| `ultra_short` | Crypto/asset price direction bets, intraday price speculation, HFT-style noise with no fundamental basis | Auto-disqualified |
| `short_term` | < 48h but event-driven (sports, news, political votes, economic data releases) | Scored normally |
| `mid_term` | 2 days – 3 months, event-driven | Scored normally |
| `long_term` | > 3 months, structural/economic/political | Scored normally |

### Initial confidence and budget

Confidence is built from trader count above minimum, lower hedge ratio, favorable current price zone, and liquidity thresholds. Budget is allocated proportionally by confidence with a `$5` minimum trade-size gate.

### AI-adjusted qualification (mid/long-term only)

Research recommendation handling:
- `strong_avoid` / `avoid` → disqualified
- `strong_buy` / `buy` → qualified
- `hold` → qualified only with stronger trader overlap

Confidence is blended: `traderSignal * 0.4 + AIScore * 0.6`.
Post-research budget is reallocated across qualified predictions.

---

## Error handling and resilience

- API wrappers throw on non-2xx by default (`fetchJson`), with service-level fallbacks.
- Leaderboard retrieval has fallback trader derivation from high-volume trade activity.
- Position/activity fetch failures degrade to empty arrays (partial pipeline continuation).
- Gamma API enrichment failures fall back to original tracker data (trade is still included).
- Research failures return conservative fallback (`hold`, confidence 30, mid_term horizon).
- Cycle-level `try/catch` in orchestrator prevents process crash from one failed cycle.

---

## State model

Two key in-memory states:

- `allPredictions` in `index.ts` (session history).
- `stats` singleton in `sniper.ts` (dashboard counters/derived metrics).

No state is persisted across restarts.

---

## External integrations and endpoints

- `https://gamma-api.polymarket.com` — market metadata, live market verification, authoritative slugs and token_ids
- `https://clob.polymarket.com` — orderbook, midpoint, trades, history
- `https://data-api.polymarket.com` — leaderboard, positions, activity (timestamped)
- Anthropic Messages API (`claude-sonnet-4-20250514`) with `web_search_20250305` tool

---

## Running the project

### Dev

`npm run dev`

### Build

`npm run build`

### Start compiled output

`npm run start`

---

## Environment variables

- `BUDGET_USDC` (default: `100`)
- `MIN_OVERLAP_TRADERS` (default: `4`)
- `MAX_HEDGE_RATIO` (default: `0.2`)
- `SCAN_INTERVAL_MS` (default: `60000`)
- `TOP_TRADERS_COUNT` (default: `20`)
- `TOP_TRADES_COUNT` (default: `5`)
- `ANTHROPIC_API_KEY` (optional; enables real-time web search research + horizon filtering)

Auth-related Polymarket vars are present but not currently used for execution:

- `POLYMARKET_PRIVATE_KEY`
- `POLYMARKET_API_KEY`
- `POLYMARKET_API_SECRET`
- `POLYMARKET_API_PASSPHRASE`
- `POLYMARKET_FUNDER_ADDRESS`

---

## Known boundaries in current design

- No order execution (read-only mode).
- No persistence layer, so no historical replay after restart.
- No explicit retry/backoff policy at HTTP client level.
- Short-term horizon filter only applies when `ANTHROPIC_API_KEY` is set; without it, no horizon classification occurs.
- Dashboard "performance" metrics are scaffolding (not tied to executed trades yet).
- Gamma enrichment doubles the candidate pool to `TOP_TRADES_COUNT * 2` — if fewer than that many overlaps exist, the output may be smaller than `TOP_TRADES_COUNT`.
