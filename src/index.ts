// ============================================================
// Polymarket Copy-Trade Sniper — Main Orchestrator
// ============================================================
// Scans top 20 most profitable Polymarket traders, detects
// overlapping unidirectional trades, runs Claude research
// agents for qualification, and outputs actionable signals.
// ============================================================

import { config } from "./config.js";
import { discoverTopTraders } from "./services/leaderboard.js";
import { detectOverlappingTrades } from "./services/tracker.js";
import { filterAndRankTrades, generatePredictions } from "./services/analyzer.js";
import { researchBatch } from "./services/agent.js";
import {
  optimizeEntryPoints,
  applyResearchResults,
  updateStats,
  getStats,
} from "./services/sniper.js";
import { renderDashboard, logPredictionBatch } from "./dashboard.js";
import { TradePrediction } from "./types.js";

// --- State ---
let isRunning = false;
let scanCycle = 0;
const allPredictions: TradePrediction[] = [];

// --- Main scan loop ---

async function runScanCycle(): Promise<void> {
  scanCycle++;
  console.log(`\n${"=".repeat(72)}`);
  console.log(`  SCAN CYCLE #${scanCycle} — ${new Date().toLocaleString()}`);
  console.log(`${"=".repeat(72)}\n`);

  try {
    // Step 1: Discover top traders
    console.log("[1/6] Discovering top traders...");
    const traders = await discoverTopTraders();

    updateStats({
      topTradersTracked: traders.length,
      scanCycleCount: scanCycle,
      lastScanTime: new Date(),
    });

    if (traders.length === 0) {
      console.log("[!] No traders found. Retrying next cycle.");
      return;
    }

    // Step 2: Detect overlapping trades
    console.log("[2/6] Detecting overlapping trades...");
    const overlaps = await detectOverlappingTrades(traders);

    const hedgedCount = overlaps.filter((o) => o.isHedged).length;
    updateStats({
      overlappingTradesFound: overlaps.length,
      hedgedTradesFiltered: hedgedCount,
    });

    if (overlaps.length === 0) {
      console.log("[!] No overlapping trades detected. Waiting for next cycle.");
      renderDashboard(getStats());
      return;
    }

    // Step 3: Filter — remove hedged, rank by conviction
    console.log("[3/6] Filtering and ranking signals...");
    const qualified = await filterAndRankTrades(overlaps);

    if (qualified.length === 0) {
      console.log("[!] All trades filtered out (hedged or insufficient overlap).");
      updateStats({
        qualifiedPredictions: 0,
        disqualifiedPredictions: overlaps.length,
      });
      renderDashboard(getStats());
      return;
    }

    // Step 4: Generate predictions with entry points
    console.log("[4/6] Generating predictions & optimizing entries...");
    let predictions = generatePredictions(qualified, config.budgetUsdc);
    predictions = await optimizeEntryPoints(predictions);

    // Step 5: Research each prediction with Claude agent
    const pendingResearch = predictions.filter(
      (p) => p.status !== "disqualified"
    );

    if (pendingResearch.length > 0 && config.anthropicApiKey) {
      console.log(
        `[5/6] Launching Claude research agents for ${pendingResearch.length} predictions...`
      );
      for (const p of pendingResearch) {
        p.status = "researching";
      }

      const researchResults = await researchBatch(pendingResearch);
      predictions = applyResearchResults(predictions, researchResults);
    } else if (!config.anthropicApiKey) {
      console.log(
        "[5/6] Skipping research (no ANTHROPIC_API_KEY). Using trader-signal-only confidence."
      );
      for (const p of predictions) {
        if (p.status !== "disqualified") {
          p.status = "qualified";
        }
      }
    }

    // Step 6: Output results
    console.log("[6/6] Rendering results...\n");

    const qualifiedPreds = predictions.filter(
      (p) => p.status === "qualified"
    );
    const disqualifiedPreds = predictions.filter(
      (p) => p.status === "disqualified"
    );

    updateStats({
      qualifiedPredictions: qualifiedPreds.length,
      disqualifiedPredictions: disqualifiedPreds.length,
      activePredictions: qualifiedPreds.length,
      currentBatch: predictions,
    });

    // Print the batch
    logPredictionBatch(predictions);

    // Show dashboard
    renderDashboard(getStats());

    // Store for history
    allPredictions.push(...predictions);
  } catch (err) {
    console.error(`[!] Scan cycle #${scanCycle} failed:`, err);
  }
}

// --- Server lifecycle ---

async function start(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║           POLYMARKET COPY-TRADE SNIPER v0.1.0                      ║
║                                                                    ║
║  Budget:          $${config.budgetUsdc} USDC${" ".repeat(42 - config.budgetUsdc.toString().length)}║
║  Min Overlap:     ${config.minOverlapTraders} traders${" ".repeat(44 - config.minOverlapTraders.toString().length)}║
║  Max Hedge Ratio: ${(config.maxHedgeRatio * 100).toFixed(0)}%${" ".repeat(48 - (config.maxHedgeRatio * 100).toFixed(0).length)}║
║  Scan Interval:   ${config.scanIntervalMs / 1000}s${" ".repeat(48 - (config.scanIntervalMs / 1000).toString().length)}║
║  Top Traders:     ${config.topTradersCount}${" ".repeat(49 - config.topTradersCount.toString().length)}║
║  Research Agent:  ${config.anthropicApiKey ? "ENABLED" : "DISABLED (no API key)"}${" ".repeat(config.anthropicApiKey ? 42 : 30)}║
║                                                                    ║
║  Mode: READ-ONLY (signals only, no trade execution)                ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  isRunning = true;

  // Initial scan
  await runScanCycle();

  // Set up recurring scans
  const intervalId = setInterval(async () => {
    if (!isRunning) {
      clearInterval(intervalId);
      return;
    }
    await runScanCycle();
  }, config.scanIntervalMs);

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[*] Shutting down sniper...");
    isRunning = false;
    clearInterval(intervalId);

    // Print final stats
    const stats = getStats();
    console.log("\n  FINAL SESSION STATS");
    console.log(`  Cycles run:     ${stats.scanCycleCount}`);
    console.log(`  Total signals:  ${allPredictions.length}`);
    console.log(
      `  Qualified:      ${allPredictions.filter((p) => p.status === "qualified").length}`
    );
    console.log(
      `  Disqualified:   ${allPredictions.filter((p) => p.status === "disqualified").length}`
    );
    console.log(`  Hit rate:       ${stats.hitRate.toFixed(1)}%`);
    console.log(`  PnL:            $${stats.totalPnL.toFixed(2)}`);
    console.log("\n  Goodbye.\n");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// --- Entry point ---
start().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
