// ============================================================
// Sniper Service — entry point optimization + budget management
// ============================================================

import { config } from "../config.js";
import {
  TradePrediction,
  AgentResearch,
  DashboardStats,
} from "../types.js";
import { getMidpoint } from "./polymarket.js";

export async function optimizeEntryPoints(
  predictions: TradePrediction[]
): Promise<TradePrediction[]> {
  console.log(
    `[sniper] Fetching live CLOB prices for ${predictions.length} predictions...`
  );

  for (const pred of predictions) {
    if (pred.status === "disqualified") continue;

    const token = pred.overlappingTrade.market.tokens?.find(
      (t) => t.outcome === (pred.direction === "YES" ? "Yes" : "No")
    );

    if (!token) {
      pred.status = "disqualified";
      continue;
    }

    try {
      // CLOB midpoint is the definitive real-time price — exactly what
      // Polymarket's UI displays as the current market price.
      const midpoint = await getMidpoint(token.token_id);

      // Propagate the live price back onto the trade so all downstream
      // code (PnL, confidence display) works from the same number.
      pred.overlappingTrade.currentPrice = midpoint;
      pred.entryPrice = Math.round(midpoint * 1000) / 1000;

      // Recalculate target relative to live price, then expected return
      pred.targetPrice = Math.min(midpoint * 1.5, 0.95);

      console.log(
        `[sniper] ${pred.overlappingTrade.market.question.slice(0, 45)}... → $${pred.entryPrice}`
      );
    } catch {
      // Fallback: use Gamma-updated currentPrice set in analyzer this cycle.
      // Never fall back to avgEntryPrice — that's what traders paid historically,
      // not the current market price.
      const fallback = pred.overlappingTrade.currentPrice;
      pred.entryPrice = Math.round(fallback * 1000) / 1000;
      pred.targetPrice = Math.min(fallback * 1.5, 0.95);
      console.warn(
        `[sniper] CLOB unavailable for "${pred.overlappingTrade.market.question.slice(0, 45)}..." — using Gamma price $${pred.entryPrice}`
      );
    }

    if (pred.entryPrice > 0) {
      pred.expectedReturn =
        ((pred.targetPrice - pred.entryPrice) / pred.entryPrice) * 100;
    }

    if (pred.expectedReturn <= 0) {
      pred.status = "disqualified";
      console.log(
        `[sniper] Disqualified "${pred.overlappingTrade.market.question.slice(0, 50)}..." — negative expected return`
      );
    }
  }

  return predictions;
}

export function applyResearchResults(
  predictions: TradePrediction[],
  researchResults: Map<string, AgentResearch>
): TradePrediction[] {
  for (const pred of predictions) {
    const research = researchResults.get(pred.id);
    if (!research) continue;

    pred.research = research;

    // Ultra-short crypto price bets and HFT-style speculation are auto-disqualified.
    // Legitimate short-term event trades (< 48h but event-driven) are scored normally.
    if (research.tradeHorizon === "ultra_short") {
      pred.status = "disqualified";
      console.log(
        `[sniper] Disqualified "${pred.overlappingTrade.market.question.slice(0, 50)}..." — ultra-short crypto/HFT speculation`
      );
      continue;
    }

    // Update confidence with research-adjusted score
    // Blend: 40% trader signal + 60% research
    pred.confidence = Math.round(
      pred.confidence * 0.4 + research.confidenceScore * 0.6
    );

    // Apply qualification/disqualification
    if (
      research.recommendation === "strong_avoid" ||
      research.recommendation === "avoid"
    ) {
      pred.status = "disqualified";
    } else if (
      research.recommendation === "strong_buy" ||
      research.recommendation === "buy"
    ) {
      pred.status = "qualified";
    } else {
      // "hold" — only qualify if trader signal is strong enough
      pred.status =
        pred.overlappingTrade.traderCount >= config.minOverlapTraders + 2
          ? "qualified"
          : "disqualified";
    }
  }

  // Reallocate budget among qualified predictions only
  const qualified = predictions.filter((p) => p.status === "qualified");
  reallocateBudget(qualified, config.budgetUsdc);

  return predictions;
}

function reallocateBudget(
  predictions: TradePrediction[],
  totalBudget: number
): void {
  const totalConfidence = predictions.reduce(
    (sum, p) => sum + p.confidence,
    0
  );

  if (totalConfidence === 0) return;

  for (const pred of predictions) {
    const share = pred.confidence / totalConfidence;
    pred.budgetAllocation = Math.floor(totalBudget * share * 100) / 100;

    // Enforce minimum order size
    if (pred.budgetAllocation < 5) {
      pred.budgetAllocation = 0;
    }
  }
}

// --- Stats tracking ---

const stats: DashboardStats = {
  totalMarketsScanned: 0,
  activeMarkets: 0,
  topTradersTracked: 0,
  lastScanTime: new Date(),
  overlappingTradesFound: 0,
  qualifiedPredictions: 0,
  disqualifiedPredictions: 0,
  hedgedTradesFiltered: 0,
  totalBudget: config.budgetUsdc,
  allocatedBudget: 0,
  remainingBudget: config.budgetUsdc,
  activePredictions: 0,
  totalTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  hitRate: 0,
  totalPnL: 0,
  avgReturnPerTrade: 0,
  currentBatch: [],
  scanCycleCount: 0,
};

export function updateStats(
  partial: Partial<DashboardStats>
): DashboardStats {
  Object.assign(stats, partial);

  // Recalculate derived fields
  stats.allocatedBudget = stats.currentBatch
    .filter((p) => p.status === "qualified" || p.status === "active")
    .reduce((sum, p) => sum + p.budgetAllocation, 0);
  stats.remainingBudget = stats.totalBudget - stats.allocatedBudget;
  stats.hitRate =
    stats.totalTrades > 0
      ? (stats.winningTrades / stats.totalTrades) * 100
      : 0;
  stats.avgReturnPerTrade =
    stats.totalTrades > 0 ? stats.totalPnL / stats.totalTrades : 0;

  return stats;
}

export function getStats(): DashboardStats {
  return { ...stats };
}
