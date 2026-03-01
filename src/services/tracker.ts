// ============================================================
// Tracker Service — detects overlapping trades among top traders
// ============================================================

import { config } from "../config.js";
import {
  TrackedTrader,
  TradeDirection,
  OverlappingTrade,
  GammaMarket,
  TraderPosition,
} from "../types.js";

interface PositionGroup {
  conditionId: string;
  title: string;
  slug: string;
  yesTraders: Array<{
    address: string;
    username: string;
    size: number;
    avgPrice: number;
    currentPrice: number;
    tokenId: string;
  }>;
  noTraders: Array<{
    address: string;
    username: string;
    size: number;
    avgPrice: number;
    currentPrice: number;
    tokenId: string;
  }>;
}

export async function detectOverlappingTrades(
  traders: TrackedTrader[]
): Promise<OverlappingTrade[]> {
  console.log(
    `[tracker] Analyzing positions across ${traders.length} traders...`
  );

  // Group all positions by conditionId (market)
  const marketPositions = new Map<string, PositionGroup>();
  let totalPositions = 0;

  // Only surface positions for markets where the trader was active in the last 24h.
  // This prevents stale weeks-old positions from generating signals.
  const RECENCY_MS = 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - RECENCY_MS;

  for (const trader of traders) {
    const recentConditionIds = new Set(
      trader.recentTrades
        .filter((t) => new Date(t.timestamp).getTime() >= cutoff)
        .map((t) => t.market)
    );

    if (recentConditionIds.size === 0) {
      console.log(
        `[tracker] ${trader.profile.username}: no trades in last 24h — skipping`
      );
      continue;
    }

    console.log(
      `[tracker] ${trader.profile.username}: ${recentConditionIds.size} active market(s) in last 24h`
    );

    for (const pos of trader.positions) {
      if (!recentConditionIds.has(pos.conditionId)) continue;

      const size = parseFloat(pos.size);
      if (size <= 0) continue;
      totalPositions++;

      const group = marketPositions.get(pos.conditionId) ?? {
        conditionId: pos.conditionId,
        title: pos.title ?? pos.conditionId.slice(0, 16),
        slug: pos.slug ?? "",
        yesTraders: [],
        noTraders: [],
      };

      // Prefer the title/slug from position data
      if (pos.title && group.title === pos.conditionId.slice(0, 16)) {
        group.title = pos.title;
      }
      if (pos.slug && !group.slug) {
        group.slug = pos.slug;
      }

      const traderEntry = {
        address: trader.profile.address,
        username: trader.profile.username,
        size,
        avgPrice: parseFloat(pos.avgPrice),
        currentPrice: parseFloat(pos.currentPrice),
        tokenId: pos.tokenId,
      };

      if (pos.outcome === "Yes") {
        group.yesTraders.push(traderEntry);
      } else {
        group.noTraders.push(traderEntry);
      }

      marketPositions.set(pos.conditionId, group);
    }
  }

  console.log(
    `[tracker] Total positions: ${totalPositions} across ${marketPositions.size} unique markets`
  );

  // Log markets with the most overlap
  const overlapCounts = Array.from(marketPositions.entries())
    .map(([, g]) => ({
      title: g.title,
      total: g.yesTraders.length + g.noTraders.length,
      yes: g.yesTraders.length,
      no: g.noTraders.length,
    }))
    .filter((x) => x.total >= 2)
    .sort((a, b) => b.total - a.total);

  if (overlapCounts.length > 0) {
    console.log(`[tracker] Markets with 2+ traders:`);
    for (const oc of overlapCounts.slice(0, 10)) {
      const label = oc.title.length > 50 ? oc.title.slice(0, 47) + "..." : oc.title;
      console.log(
        `  - ${label} : ${oc.total} traders (YES:${oc.yes} NO:${oc.no})`
      );
    }
  }

  // Filter to markets where multiple traders overlap
  const overlaps: OverlappingTrade[] = [];

  for (const [conditionId, group] of marketPositions) {
    const totalTraders = group.yesTraders.length + group.noTraders.length;
    if (totalTraders < config.minOverlapTraders) continue;

    // Determine majority direction
    const yesCount = group.yesTraders.length;
    const noCount = group.noTraders.length;
    const majorityDirection: TradeDirection = yesCount >= noCount ? "YES" : "NO";
    const majorityTraders =
      majorityDirection === "YES" ? group.yesTraders : group.noTraders;
    const minorityCount = Math.min(yesCount, noCount);
    const hedgeRatio = totalTraders > 0 ? minorityCount / totalTraders : 0;

    // Build a lightweight market object from position data
    const firstTrader = majorityTraders[0]!;
    const currentPrice = firstTrader.currentPrice;

    const avgEntryPrice =
      majorityTraders.reduce((sum, t) => sum + t.avgPrice, 0) /
      majorityTraders.length;

    // Create a minimal GammaMarket from position data
    const market: GammaMarket = {
      id: conditionId,
      question: group.title,
      slug: group.slug,
      conditionId,
      tokens: [
        {
          token_id: firstTrader.tokenId,
          outcome: majorityDirection === "YES" ? "Yes" : "No",
          price: currentPrice,
        },
      ],
      volume: "0",
      liquidity: "0",
      startDate: "",
      endDate: "",
      closed: false,
      active: true,
      description: "",
      category: "",
      minimum_order_size: 5,
      minimum_tick_size: 0.01,
      negRisk: false,
    };

    overlaps.push({
      conditionId,
      market,
      direction: majorityDirection,
      traders: majorityTraders.map((t) => ({
        address: t.address,
        username: t.username,
        position: {
          user: t.address,
          conditionId,
          tokenId: t.tokenId,
          outcome: majorityDirection === "YES" ? "Yes" : "No",
          size: t.size.toString(),
          avgPrice: t.avgPrice.toString(),
          currentPrice: t.currentPrice.toString(),
          pnl: ((t.currentPrice - t.avgPrice) * t.size).toFixed(2),
        },
        entryPrice: t.avgPrice,
      })),
      traderCount: majorityTraders.length,
      avgEntryPrice,
      currentPrice,
      isHedged: hedgeRatio > config.maxHedgeRatio,
      hedgeRatio,
      detectedAt: new Date(),
    });
  }

  // Sort by trader count (most conviction first)
  overlaps.sort((a, b) => b.traderCount - a.traderCount);

  console.log(
    `[tracker] Found ${overlaps.length} overlapping trades (${
      overlaps.filter((o) => !o.isHedged).length
    } unidirectional)`
  );

  return overlaps;
}
