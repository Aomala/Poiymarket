# Module: `src/dashboard.ts`

## Responsibility

Renders the terminal UI for scanner status, signal pipeline metrics, budget/performance, and active prediction details including full AI research rationale.

## Main exports

- **`renderDashboard(stats)`**
  - Clears console and prints the main view.
  - Sections: Scanner Status, Signal Pipeline, Budget, Performance, Current Predictions.
  - Renders each prediction in the current batch via `renderPrediction`.

- **`logPredictionBatch(predictions)`**
  - Prints batch-level qualified/disqualified outputs with market links.
  - Shows disqualification reason for each rejected prediction.

## `renderPrediction(pred)` — per-trade display

For each prediction, prints:
- Market question (truncated to 55 chars), status icon, and `polymarket.com/event/{slug}` link (slug sourced from Gamma API).
- Direction label, trader count, hedge ratio.
- Entry → Target price, Expected return, Confidence, Budget allocation.
- **AI Research block** (when `pred.research` exists):
  - One-line header: `AI Research: RECOMMENDATION | HORIZON | confidence: N%`
    - Horizon labels: `SHORT-TERM ⚡`, `MID-TERM`, `LONG-TERM`
  - Full rationale word-wrapped at column 72 (no truncation).
  - First qualifying factor (Bullish).
  - First disqualifying factor (Bearish).

## Presentation helpers

- `getStatusIcon(status)` — maps prediction status to a bracket symbol (`[+]`, `[x]`, `[~]`, etc.).
- Uses `getDirectionLabel(market, direction)` from `utils.ts` for human-readable prediction phrasing.

## Why it matters

This module is the operator-facing visibility layer for every cycle, surfacing the full research rationale and trade horizon so decisions are transparent and auditable.
