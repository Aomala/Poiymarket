// ============================================================
// Leaderboard Service — discovers and ranks top traders
// ============================================================
//
// Two-tier refresh strategy:
//
//   Trader list (who we watch) — rebuilt every TRADER_LIST_TTL_MS (30 min).
//   The weekly leaderboard changes slowly; rebuilding it every scan cycle
//   wastes ~80 API calls per minute for no meaningful change.
//
//   Trader data (positions + activity) — refreshed every scan cycle so
//   the 24h recency filter in the tracker always has up-to-date signals.
//
// ============================================================

import { config } from "../config.js";
import { TrackedTrader, TraderProfile } from "../types.js";
import {
  getTopTraders,
  getTraderPositions,
  getTraderActivity,
} from "./polymarket.js";

const CANDIDATE_POOL_SIZE = 50;
const MIN_RECENT_TRADES = 5;

// How long to keep the same trader selection before re-running leaderboard discovery.
// The weekly leaderboard changes over hours, not minutes.
const TRADER_LIST_TTL_MS = 30 * 60 * 1000; // 30 minutes

const trackedTraders = new Map<string, TrackedTrader>();
let traderListBuiltAt: number | null = null;

export async function discoverTopTraders(): Promise<TrackedTrader[]> {
  const now = Date.now();
  const listIsStale =
    traderListBuiltAt === null ||
    now - traderListBuiltAt > TRADER_LIST_TTL_MS;

  if (listIsStale) {
    await rebuildTraderList();
  } else {
    const ageMinutes = Math.round((now - traderListBuiltAt!) / 60_000);
    console.log(
      `[leaderboard] Trader list is fresh (${ageMinutes}m old) — refreshing positions only`
    );
    await refreshTraderData();
  }

  return Array.from(trackedTraders.values());
}

// ─── Full leaderboard discovery ───────────────────────────────────────────────
// Runs on first cycle and every 30 minutes. Fetches leaderboard, filters,
// hydrates candidates, scores by efficiency + win rate, selects top N.

async function rebuildTraderList(): Promise<void> {
  console.log(
    `[leaderboard] Rebuilding trader list (top ${config.topTradersCount}, weekly)...`
  );

  const weeklyRaw = await getTopTraders(CANDIDATE_POOL_SIZE, "weekly");

  // Must be profitable this week
  const profitable = weeklyRaw.filter((t) => t.pnl > 0);
  console.log(
    `[leaderboard] ${profitable.length}/${weeklyRaw.length} traders profitable this week`
  );

  if (profitable.length === 0) {
    console.log("[leaderboard] No profitable traders found — keeping previous list");
    return;
  }

  // Volume floor: must be at or above the median weekly volume in the pool
  const sortedByVol = [...profitable].sort((a, b) => b.volume - a.volume);
  const medianVolume = sortedByVol[Math.floor(sortedByVol.length / 2)]!.volume;
  const highVolume = profitable.filter((t) => t.volume >= medianVolume);
  console.log(
    `[leaderboard] ${highVolume.length} traders above median weekly volume ($${medianVolume.toLocaleString()})`
  );

  // Hydrate top 40 by PnL
  const toHydrate = highVolume.sort((a, b) => b.pnl - a.pnl).slice(0, 40);
  console.log(`[leaderboard] Hydrating ${toHydrate.length} candidates...`);

  const results = await Promise.allSettled(
    toHydrate.map((profile) => hydrateTrader(profile))
  );

  const hydrated: TrackedTrader[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") hydrated.push(result.value);
  }

  // Must have enough recent trade activity
  const active = hydrated.filter((t) => t.recentTrades.length >= MIN_RECENT_TRADES);
  console.log(
    `[leaderboard] ${active.length} traders with ${MIN_RECENT_TRADES}+ recent trades`
  );

  // Score and rank
  const ranked = rankByConsistency(active);
  const top = ranked.slice(0, config.topTradersCount);

  // Replace tracked list
  trackedTraders.clear();
  for (const trader of top) {
    trackedTraders.set(trader.profile.address, trader);
  }
  traderListBuiltAt = Date.now();

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
}

// ─── Lightweight per-cycle refresh ───────────────────────────────────────────
// Runs every scan cycle when the trader list is still fresh.
// Only re-fetches positions + activity — skips the expensive leaderboard
// selection pipeline entirely.

async function refreshTraderData(): Promise<void> {
  const addresses = Array.from(trackedTraders.keys());
  console.log(
    `[leaderboard] Refreshing positions + activity for ${addresses.length} tracked traders...`
  );

  const results = await Promise.allSettled(
    addresses.map(async (address) => {
      const existing = trackedTraders.get(address)!;
      const [positions, recentTrades] = await Promise.all([
        getTraderPositions(address),
        getTraderActivity(address),
      ]);
      const updated: TrackedTrader = {
        ...existing,
        positions,
        recentTrades,
        lastScanned: new Date(),
      };
      trackedTraders.set(address, updated);
    })
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  console.log(
    `[leaderboard] Data refreshed for ${succeeded}/${addresses.length} traders`
  );
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function rankByConsistency(traders: TrackedTrader[]): TrackedTrader[] {
  const withMetrics = traders.map((trader) => {
    const { pnl, volume } = trader.profile;
    const efficiency = volume > 0 ? pnl / volume : 0;

    const posWithData = trader.positions.filter(
      (p) => p.pnl !== "0" && p.pnl !== "" && !isNaN(parseFloat(p.pnl))
    );
    const winRate =
      posWithData.length > 0
        ? posWithData.filter((p) => parseFloat(p.pnl) > 0).length /
          posWithData.length
        : 0.5;

    return { trader, efficiency, winRate };
  });

  const maxEfficiency = Math.max(...withMetrics.map((x) => x.efficiency), 1e-9);

  return withMetrics
    .map((x) => ({
      trader: x.trader,
      score: (x.efficiency / maxEfficiency) * 0.5 + x.winRate * 0.5,
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.trader);
}

// ─── Hydration ────────────────────────────────────────────────────────────────

async function hydrateTrader(profile: TraderProfile): Promise<TrackedTrader> {
  const [positions, recentTrades] = await Promise.all([
    getTraderPositions(profile.address),
    getTraderActivity(profile.address),
  ]);
  return { profile, positions, recentTrades, lastScanned: new Date() };
}

export function getTrackedTraders(): TrackedTrader[] {
  return Array.from(trackedTraders.values());
}

export function getTrader(address: string): TrackedTrader | undefined {
  return trackedTraders.get(address);
}
