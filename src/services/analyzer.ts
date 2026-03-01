// ============================================================
// Analyzer Service — filters signals and generates predictions
// ============================================================

import { config } from "../config.js";
import {
  OverlappingTrade,
  TradePrediction,
} from "../types.js";
import { getMarket } from "./polymarket.js";

function generateId(): string {
  return `pred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function filterAndRankTrades(
  overlaps: OverlappingTrade[]
): Promise<OverlappingTrade[]> {
  // 1. Remove hedged trades (traders going both directions)
  const unidirectional = overlaps.filter((o) => !o.isHedged);

  console.log(
    `[analyzer] Filtered: ${overlaps.length} total → ${unidirectional.length} unidirectional (removed ${overlaps.length - unidirectional.length} hedged)`
  );

  // 2. Must have minimum overlap count
  const qualified = unidirectional.filter(
    (o) => o.traderCount >= config.minOverlapTraders
  );

  // 3. Sort by conviction (trader count) then by avg entry price advantage
  qualified.sort((a, b) => {
    if (b.traderCount !== a.traderCount) return b.traderCount - a.traderCount;
    // Prefer trades where entry is further from 0.5 (stronger conviction)
    const aConviction = Math.abs(a.avgEntryPrice - 0.5);
    const bConviction = Math.abs(b.avgEntryPrice - 0.5);
    return bConviction - aConviction;
  });

  // 4. Take a larger candidate pool to compensate for expired markets filtered below
  const candidates = qualified.slice(0, config.topTradesCount * 2);

  // 5. Enrich from Gamma API: verify market is live, replace synthetic market
  //    object with real data (authoritative slug, real token_ids for orderbook
  //    lookups, live liquidity), and update currentPrice to live token price.
  const live: OverlappingTrade[] = [];
  await Promise.allSettled(
    candidates.map(async (trade) => {
      try {
        const gammaMarket = await getMarket(trade.conditionId);

        if (gammaMarket.closed || !gammaMarket.active) {
          console.log(
            `[analyzer] Skipping expired market: "${trade.market.question.slice(0, 55)}"`
          );
          return;
        }

        trade.market = gammaMarket;

        const token = gammaMarket.tokens.find(
          (t) => t.outcome === (trade.direction === "YES" ? "Yes" : "No")
        );
        if (token) {
          trade.currentPrice = token.price;
        }

        live.push(trade);
      } catch {
        // Gamma API unavailable — include with original stale data as fallback
        live.push(trade);
      }
    })
  );

  // Re-sort after concurrent fetches (order not guaranteed)
  live.sort((a, b) => {
    if (b.traderCount !== a.traderCount) return b.traderCount - a.traderCount;
    const aConviction = Math.abs(a.avgEntryPrice - 0.5);
    const bConviction = Math.abs(b.avgEntryPrice - 0.5);
    return bConviction - aConviction;
  });

  return live.slice(0, config.topTradesCount);
}

export function generatePredictions(
  qualifiedTrades: OverlappingTrade[],
  budget: number
): TradePrediction[] {
  if (qualifiedTrades.length === 0) return [];

  // Calculate expected returns for each trade
  const predictions: TradePrediction[] = qualifiedTrades.map((trade) => {
    const entryPrice = calculateOptimalEntry(trade);
    const targetPrice = calculateTarget(trade);
    const expectedReturn =
      entryPrice > 0 ? ((targetPrice - entryPrice) / entryPrice) * 100 : 0;

    return {
      id: generateId(),
      overlappingTrade: trade,
      direction: trade.direction,
      confidence: calculateInitialConfidence(trade),
      entryPrice,
      targetPrice,
      expectedReturn,
      budgetAllocation: 0, // Set below
      status: "pending",
      createdAt: new Date(),
    };
  });

  // Allocate budget proportionally by confidence
  allocateBudget(predictions, budget);

  return predictions;
}

function calculateOptimalEntry(trade: OverlappingTrade): number {
  // Sniper logic: enter at or below the average entry of top traders
  // We want to enter at a price that gives us edge even in worst case
  const { avgEntryPrice, currentPrice, direction } = trade;

  if (direction === "YES") {
    // For YES bets, lower entry = better
    // Target: min of avg entry and current price, with a small discount
    return Math.min(avgEntryPrice, currentPrice) * 0.98;
  } else {
    // For NO bets, token price is (1 - yesPrice), lower is better
    return Math.min(avgEntryPrice, currentPrice) * 0.98;
  }
}

function calculateTarget(trade: OverlappingTrade): number {
  // Target is a conservative 50% gain above the current live price, capped
  // before full resolution. Uses currentPrice (Gamma-updated this cycle) so
  // the target is always relative to today's entry, not historical avg.
  return Math.min(trade.currentPrice * 1.5, 0.95);
}

function calculateInitialConfidence(trade: OverlappingTrade): number {
  let confidence = 50; // Base

  // More traders = more confidence (+5 per trader over minimum)
  confidence += (trade.traderCount - config.minOverlapTraders) * 5;

  // Lower hedge ratio = more confidence
  confidence += (1 - trade.hedgeRatio) * 15;

  // Price between 0.2-0.8 is more actionable (not too cheap / too expensive)
  const price = trade.currentPrice;
  if (price >= 0.2 && price <= 0.8) confidence += 10;

  // Higher market liquidity = more confidence
  const liquidity = parseFloat(trade.market.liquidity || "0");
  if (liquidity > 100000) confidence += 10;
  else if (liquidity > 50000) confidence += 5;

  return Math.min(Math.max(confidence, 10), 95); // Clamp 10-95
}

function allocateBudget(
  predictions: TradePrediction[],
  totalBudget: number
): void {
  const totalConfidence = predictions.reduce(
    (sum, p) => sum + p.confidence,
    0
  );

  if (totalConfidence === 0) return;

  for (const pred of predictions) {
    // Proportional allocation by confidence
    const share = pred.confidence / totalConfidence;
    pred.budgetAllocation = Math.floor(totalBudget * share * 100) / 100;

    // Enforce minimum order size ($5 on Polymarket)
    if (pred.budgetAllocation < 5) {
      pred.budgetAllocation = 0;
      pred.status = "disqualified";
    }
  }
}
