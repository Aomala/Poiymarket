// ============================================================
// Console Dashboard — renders stats and predictions
// ============================================================

import { DashboardStats, TradePrediction } from "./types.js";
import { getDirectionLabel } from "./utils.js";

const DIVIDER = "═".repeat(72);
const THIN_DIVIDER = "─".repeat(72);

export function renderDashboard(stats: DashboardStats): void {
  console.clear();
  console.log(`\n${DIVIDER}`);
  console.log(
    `  POLYMARKET COPY-TRADE SNIPER              ${new Date().toLocaleTimeString()}`
  );
  console.log(DIVIDER);

  // --- Scanner Status ---
  console.log("\n  SCANNER STATUS");
  console.log(THIN_DIVIDER);
  console.log(
    `  Scan Cycle:        #${stats.scanCycleCount}`
  );
  console.log(
    `  Last Scan:         ${stats.lastScanTime.toLocaleTimeString()}`
  );
  console.log(
    `  Traders Tracked:   ${stats.topTradersTracked}`
  );
  console.log(
    `  Active Markets:    ${stats.activeMarkets}`
  );
  console.log(
    `  Overlapping Trades: ${stats.overlappingTradesFound}`
  );
  console.log(
    `  Hedged (filtered): ${stats.hedgedTradesFiltered}`
  );

  // --- Signal Summary ---
  console.log("\n  SIGNAL PIPELINE");
  console.log(THIN_DIVIDER);
  console.log(
    `  Qualified:         ${stats.qualifiedPredictions}`
  );
  console.log(
    `  Disqualified:      ${stats.disqualifiedPredictions}`
  );
  console.log(
    `  Active:            ${stats.activePredictions}`
  );

  // --- Budget ---
  console.log("\n  BUDGET");
  console.log(THIN_DIVIDER);
  console.log(
    `  Total:             $${stats.totalBudget.toFixed(2)} USDC`
  );
  console.log(
    `  Allocated:         $${stats.allocatedBudget.toFixed(2)} USDC`
  );
  console.log(
    `  Remaining:         $${stats.remainingBudget.toFixed(2)} USDC`
  );

  // --- Performance ---
  console.log("\n  PERFORMANCE");
  console.log(THIN_DIVIDER);
  console.log(
    `  Total Trades:      ${stats.totalTrades}`
  );
  console.log(
    `  Win / Loss:        ${stats.winningTrades} / ${stats.losingTrades}`
  );
  console.log(
    `  Hit Rate:          ${stats.hitRate.toFixed(1)}%  ${stats.hitRate >= 80 ? "(TARGET MET)" : `(target: 80%)`}`
  );
  console.log(
    `  Total PnL:         ${stats.totalPnL >= 0 ? "+" : ""}$${stats.totalPnL.toFixed(2)}`
  );
  console.log(
    `  Avg Return/Trade:  ${stats.avgReturnPerTrade >= 0 ? "+" : ""}${stats.avgReturnPerTrade.toFixed(2)}%`
  );

  // --- Current Batch ---
  if (stats.currentBatch.length > 0) {
    console.log("\n  CURRENT PREDICTIONS");
    console.log(DIVIDER);
    for (const pred of stats.currentBatch) {
      renderPrediction(pred);
    }
  } else {
    console.log("\n  No active predictions — waiting for signals...");
  }

  console.log(`\n${DIVIDER}\n`);
}

function renderPrediction(pred: TradePrediction): void {
  const trade = pred.overlappingTrade;
  const statusIcon = getStatusIcon(pred.status);
  const question =
    trade.market.question.length > 55
      ? trade.market.question.slice(0, 52) + "..."
      : trade.market.question;

  const marketUrl = `https://polymarket.com/event/${trade.market.slug}`;

  console.log(`\n  ${statusIcon} ${question}`);
  console.log(`     Link:         ${marketUrl}`);
  const directionLabel = getDirectionLabel(trade.market, pred.direction);
  console.log(`     Prediction:   ${directionLabel}`);
  console.log(
    `     Traders:      ${trade.traderCount} aligned | hedge ratio: ${(trade.hedgeRatio * 100).toFixed(0)}%`
  );
  console.log(
    `     Entry:        $${pred.entryPrice.toFixed(3)} → Target: $${pred.targetPrice.toFixed(3)}`
  );
  console.log(
    `     Expected:     ${pred.expectedReturn >= 0 ? "+" : ""}${pred.expectedReturn.toFixed(1)}%`
  );
  console.log(
    `     Confidence:   ${pred.confidence}%`
  );
  console.log(
    `     Budget:       $${pred.budgetAllocation.toFixed(2)} USDC`
  );

  if (pred.research) {
    const r = pred.research;
    const horizonLabel =
      r.tradeHorizon === "ultra_short" ? "ULTRA-SHORT [SPEC]"
      : r.tradeHorizon === "short_term" ? "SHORT-TERM (<48h)"
      : r.tradeHorizon === "long_term" ? "LONG-TERM"
      : "MID-TERM";
    console.log(
      `     AI Research:  ${r.recommendation.toUpperCase()} | ${horizonLabel} | confidence: ${r.confidenceScore}%`
    );
    // Print rationale wrapped at ~65 chars per line
    const words = r.rationale.split(" ");
    let line = "     Rationale:   ";
    for (const word of words) {
      if (line.length + word.length + 1 > 72) {
        console.log(line);
        line = "                  " + word + " ";
      } else {
        line += word + " ";
      }
    }
    if (line.trim()) console.log(line);

    if (r.qualifyingFactors.length > 0) {
      console.log(`     Bullish:      ${r.qualifyingFactors[0]}`);
    }
    if (r.disqualifyingFactors.length > 0) {
      console.log(`     Bearish:      ${r.disqualifyingFactors[0]}`);
    }
  }

  console.log(`     Status:       ${pred.status.toUpperCase()}`);
  console.log(THIN_DIVIDER);
}

function getStatusIcon(status: TradePrediction["status"]): string {
  switch (status) {
    case "pending":
      return "[?]";
    case "researching":
      return "[~]";
    case "qualified":
      return "[+]";
    case "disqualified":
      return "[x]";
    case "executing":
      return "[>]";
    case "active":
      return "[*]";
    case "closed":
      return "[-]";
    default:
      return "[ ]";
  }
}

export function logPredictionBatch(predictions: TradePrediction[]): void {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`  PREDICTION BATCH — ${new Date().toLocaleString()}`);
  console.log(`  ${predictions.length} predictions detected`);
  console.log(`${"=".repeat(72)}`);

  const qualified = predictions.filter(
    (p) => p.status === "qualified"
  );
  const disqualified = predictions.filter(
    (p) => p.status === "disqualified"
  );

  if (qualified.length > 0) {
    console.log(
      `\n  QUALIFIED TRADES (${qualified.length}):`
    );
    for (const pred of qualified) {
      renderPrediction(pred);
    }
  }

  if (disqualified.length > 0) {
    console.log(
      `\n  DISQUALIFIED TRADES (${disqualified.length}):`
    );
    for (const pred of disqualified) {
      const reason =
        pred.research?.recommendation === "avoid" ||
        pred.research?.recommendation === "strong_avoid"
          ? "Research: " + (pred.research?.rationale?.slice(0, 60) ?? "")
          : pred.overlappingTrade.isHedged
            ? "Hedged position detected"
            : "Insufficient confidence";
      const slug = pred.overlappingTrade.market.slug;
      console.log(
        `  [x] ${pred.overlappingTrade.market.question.slice(0, 50)}... — ${reason}`
      );
      console.log(
        `      https://polymarket.com/event/${slug}`
      );
    }
  }

  console.log(`\n${"=".repeat(72)}\n`);
}
