# Module: `src/index.ts` (Main Orchestrator)

## Responsibility

Coordinates the full scan lifecycle and process lifecycle.

## Key flow

- Maintains run state (`isRunning`, `scanCycle`, `allPredictions`).
- Runs `runScanCycle()` on startup and every `SCAN_INTERVAL_MS`.
- Executes the 6 pipeline steps in order:
  1. Trader discovery
  2. Overlap detection (with 24h recency filter)
  3. Filtering, ranking, Gamma enrichment, and expired market removal (`await filterAndRankTrades`)
  4. Prediction generation + real-time entry optimization
  5. Optional AI research with web search + short-term disqualification
  6. Rendering, logging, and state update

## Important behaviors

- Updates dashboard stats at each stage via `updateStats(...)`.
- Handles no-data branches gracefully (no traders, no overlaps, no qualified trades).
- Skips AI research if no `ANTHROPIC_API_KEY` is configured; qualifies all non-disqualified predictions as trader-signal-only.
- Catches cycle errors so one failed cycle does not kill the process.
- Handles `SIGINT`/`SIGTERM` and prints final session stats before exit.

## Inputs and outputs

- **Inputs:** Config + live service outputs from Polymarket APIs and Anthropic.
- **Outputs:** Console logs, dashboard render, in-memory session history (`allPredictions`).
