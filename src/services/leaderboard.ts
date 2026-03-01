// ============================================================
// Leaderboard Service — discovers and ranks top traders
// ============================================================

import { config } from "../config.js";
import { TrackedTrader, TraderProfile } from "../types.js";
import {
  getTopTraders,
  getTraderPositions,
  getTraderActivity,
} from "./polymarket.js";

// Fetch a larger pool so filters have room to operate
const CANDIDATE_POOL_SIZE = 50;

// Minimum number of recent trades — confirms the trader is actively trading,
// not just holding one lucky old position
const MIN_RECENT_TRADES = 5;

const trackedTraders = new Map<string, TrackedTrader>();

export async function discoverTopTraders(): Promise<TrackedTrader[]> {
  console.log(
    `[leaderboard] Discovering top ${config.topTradersCount} traders (weekly)...`
  );

  // Weekly leaderboard only — captures current conviction, not stale history
  const weeklyRaw = await getTopTraders(CANDIDATE_POOL_SIZE, "weekly");

  // Filter 1: must have been profitable this week
  const profitable = weeklyRaw.filter((t) => t.pnl > 0);
  console.log(
    `[leaderboard] ${profitable.length}/${weeklyRaw.length} traders profitable this week`
  );

  if (profitable.length === 0) {
    console.log("[leaderboard] No profitable traders found this week.");
    return [];
  }

  // Filter 2: volume floor — require at least the median weekly volume in the
  // pool. This adapts to the actual distribution and filters out low-stakes traders.
  const sortedByVol = [...profitable].sort((a, b) => b.volume - a.volume);
  const medianVolume = sortedByVol[Math.floor(sortedByVol.length / 2)]!.volume;
  const highVolume = profitable.filter((t) => t.volume >= medianVolume);
  console.log(
    `[leaderboard] ${highVolume.length} traders above median weekly volume ($${medianVolume.toLocaleString()})`
  );

  // Take top candidates by PnL for hydration (cap to avoid excessive API calls)
  const toHydrate = highVolume
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 40);

  console.log(`[leaderboard] Hydrating ${toHydrate.length} candidates...`);

  // Hydrate: fetch open positions + recent trade activity for each candidate
  const results = await Promise.allSettled(
    toHydrate.map((profile) => hydrateTrader(profile))
  );

  const hydrated: TrackedTrader[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      hydrated.push(result.value);
    }
  }

  // Filter 3: must have enough recent trade activity to confirm active trading
  const active = hydrated.filter(
    (t) => t.recentTrades.length >= MIN_RECENT_TRADES
  );
  console.log(
    `[leaderboard] ${active.length} traders with ${MIN_RECENT_TRADES}+ recent trades`
  );

  // Score and rank by consistency + capital efficiency
  const ranked = rankByConsistency(active);
  const top = ranked.slice(0, config.topTradersCount);

  // Log the selected traders with their key metrics
  console.log(`[leaderboard] Selected ${top.length} traders:`);
  for (const t of top) {
    const roi =
      t.profile.volume > 0
        ? ((t.profile.pnl / t.profile.volume) * 100).toFixed(1)
        : "0";
    const profitable = t.positions.filter((p) => parseFloat(p.pnl) > 0).length;
    const total = t.positions.length;
    console.log(
      `  ${t.profile.username.padEnd(20)} | PnL: $${t.profile.pnl.toLocaleString().padStart(10)} | Vol: $${t.profile.volume.toLocaleString().padStart(12)} | ROI: ${roi.padStart(5)}% | Pos win: ${profitable}/${total}`
    );
  }

  for (const trader of top) {
    trackedTraders.set(trader.profile.address, trader);
  }

  return top;
}

/**
 * Scores a trader by two equally-weighted factors:
 *
 * 1. PnL efficiency (ROI on volume) — normalised within the pool to 0-1.
 *    A trader who made $50k on $200k volume (25% ROI) ranks higher than
 *    one who made $50k on $2M volume (2.5% ROI).
 *
 * 2. Open-position win rate — fraction of current positions that are
 *    profitable. Used as a proxy for consistency since closed-trade
 *    history is not available from the API.
 *
 * Final score = normalised_efficiency * 0.5 + win_rate * 0.5
 */
function rankByConsistency(traders: TrackedTrader[]): TrackedTrader[] {
  const withMetrics = traders.map((trader) => {
    const { pnl, volume } = trader.profile;

    // ROI on weekly volume
    const efficiency = volume > 0 ? pnl / volume : 0;

    // Win rate from open positions that carry a non-zero PnL
    const posWithData = trader.positions.filter(
      (p) => p.pnl !== "0" && p.pnl !== "" && !isNaN(parseFloat(p.pnl))
    );
    const winRate =
      posWithData.length > 0
        ? posWithData.filter((p) => parseFloat(p.pnl) > 0).length /
          posWithData.length
        : 0.5; // neutral when no position PnL data available

    return { trader, efficiency, winRate };
  });

  // Normalise efficiency to 0-1 within the pool so both factors are comparable
  const maxEfficiency = Math.max(...withMetrics.map((x) => x.efficiency), 1e-9);

  return withMetrics
    .map((x) => ({
      trader: x.trader,
      score: (x.efficiency / maxEfficiency) * 0.5 + x.winRate * 0.5,
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.trader);
}

async function hydrateTrader(profile: TraderProfile): Promise<TrackedTrader> {
  const [positions, recentTrades] = await Promise.all([
    getTraderPositions(profile.address),
    getTraderActivity(profile.address),
  ]);

  return {
    profile,
    positions,
    recentTrades,
    lastScanned: new Date(),
  };
}

export function getTrackedTraders(): TrackedTrader[] {
  return Array.from(trackedTraders.values());
}

export function getTrader(address: string): TrackedTrader | undefined {
  return trackedTraders.get(address);
}
