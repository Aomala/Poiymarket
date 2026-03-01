// ============================================================
// Polymarket API Client
// Wraps: data-api.polymarket.com, gamma-api, CLOB
// ============================================================

import { config } from "../config.js";
import {
  GammaMarket,
  TraderPosition,
  TradeRecord,
  TraderProfile,
} from "../types.js";

const GAMMA = config.gammaHost;
const CLOB = config.clobHost;
const DATA_API = "https://data-api.polymarket.com";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${url} — ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// --- Markets ---

export async function getActiveMarkets(
  limit = 100,
  offset = 0
): Promise<GammaMarket[]> {
  const url = `${GAMMA}/markets?closed=false&active=true&limit=${limit}&offset=${offset}`;
  return fetchJson<GammaMarket[]>(url);
}

export async function getMarket(conditionId: string): Promise<GammaMarket> {
  const url = `${GAMMA}/markets?id=${conditionId}`;
  const markets = await fetchJson<GammaMarket[]>(url);
  const market = markets[0];
  if (!market) throw new Error(`Market not found: ${conditionId}`);
  return market;
}

// --- Leaderboard (data-api.polymarket.com) ---

interface LeaderboardEntry {
  proxyWallet: string;
  userName: string;
  vol: number;
  pnl: number;
  profileImage?: string;
  rank: string;
  xUsername?: string;
  verifiedBadge?: boolean;
}

const PERIOD_MAP = {
  daily: "DAY",
  weekly: "WEEK",
  monthly: "MONTH",
  all: "ALL",
} as const;

export async function getTopTraders(
  count: number,
  period: "daily" | "weekly" | "monthly" | "all" = "weekly"
): Promise<TraderProfile[]> {
  const timePeriod = PERIOD_MAP[period];
  const limit = Math.min(count, 50);
  const url = `${DATA_API}/v1/leaderboard?timePeriod=${timePeriod}&orderBy=PNL&limit=${limit}&offset=0`;

  try {
    const entries = await fetchJson<LeaderboardEntry[]>(url);

    return entries.slice(0, count).map((e, i) => ({
      address: e.proxyWallet,
      username: e.userName || `trader_${i}`,
      profileImage: e.profileImage,
      pnl: e.pnl ?? 0,
      volume: e.vol ?? 0,
      marketsTraded: 0,
      rank: parseInt(e.rank) || i + 1,
      winRate: 0,
    }));
  } catch (err) {
    console.error("[polymarket] Leaderboard fetch failed, using fallback:", err);
    return getTopTradersFallback(count);
  }
}

// Fallback: derive traders from high-volume market trades
async function getTopTradersFallback(count: number): Promise<TraderProfile[]> {
  const markets = await getActiveMarkets(20);
  const traderMap = new Map<string, { volume: number; pnl: number; markets: Set<string> }>();

  for (const market of markets.slice(0, 10)) {
    const token = market.tokens?.[0];
    if (!token) continue;

    try {
      const trades = await getRecentTrades(token.token_id, 200);
      for (const trade of trades) {
        const existing = traderMap.get(trade.owner) ?? {
          volume: 0,
          pnl: 0,
          markets: new Set<string>(),
        };
        existing.volume += parseFloat(trade.size) * parseFloat(trade.price);
        existing.markets.add(trade.market);
        traderMap.set(trade.owner, existing);
      }
    } catch {
      // skip
    }
  }

  return Array.from(traderMap.entries())
    .sort((a, b) => b[1].volume - a[1].volume)
    .slice(0, count)
    .map(([address, data], i) => ({
      address,
      username: `trader_${address.slice(0, 8)}`,
      pnl: data.pnl,
      volume: data.volume,
      marketsTraded: data.markets.size,
      rank: i + 1,
      winRate: 0,
    }));
}

// --- Trader Positions (data-api.polymarket.com/positions) ---

interface DataApiPosition {
  proxyWallet: string;
  asset: string;
  conditionId: string;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  cashPnl: number;
  percentPnl: number;
  curPrice: number;
  title: string;
  slug: string;
  outcome: string;
  outcomeIndex: number;
  endDate: string;
  negativeRisk: boolean;
}

export async function getTraderPositions(
  address: string,
  limit = 100
): Promise<TraderPosition[]> {
  const url = `${DATA_API}/positions?user=${address}&limit=${limit}&sizeThreshold=0.1&sortBy=TOKENS&sortDirection=DESC`;
  try {
    const positions = await fetchJson<DataApiPosition[]>(url);
    return positions.map((p) => ({
      user: p.proxyWallet,
      conditionId: p.conditionId,
      tokenId: p.asset,
      outcome: p.outcome,
      size: p.size.toString(),
      avgPrice: p.avgPrice.toString(),
      currentPrice: p.curPrice.toString(),
      pnl: p.cashPnl.toString(),
      title: p.title,
      slug: p.slug,
    }));
  } catch {
    return [];
  }
}

// --- Trader Activity (data-api.polymarket.com/activity) ---

interface DataApiActivity {
  proxyWallet: string;
  timestamp: number;
  conditionId: string;
  type: string;
  size: number;
  usdcSize: number;
  price: number;
  asset: string;
  side: "BUY" | "SELL";
  outcomeIndex: number;
  title: string;
  slug: string;
  outcome: string;
  transactionHash: string;
}

export async function getTraderActivity(
  address: string,
  limit = 100
): Promise<TradeRecord[]> {
  const url = `${DATA_API}/activity?user=${address}&type=TRADE&limit=${limit}&sortBy=TIMESTAMP&sortDirection=DESC`;
  try {
    const activities = await fetchJson<DataApiActivity[]>(url);
    return activities.map((a) => ({
      id: a.transactionHash,
      taker_order_id: "",
      market: a.conditionId,
      asset_id: a.asset,
      side: a.side,
      size: a.size.toString(),
      price: a.price.toString(),
      timestamp: new Date(a.timestamp * 1000).toISOString(),
      owner: a.proxyWallet,
      outcome: a.outcome,
    }));
  } catch {
    return [];
  }
}

// --- CLOB Trades ---

export async function getRecentTrades(
  tokenId: string,
  limit = 100
): Promise<TradeRecord[]> {
  const url = `${CLOB}/trades?asset_id=${tokenId}&limit=${limit}`;
  return fetchJson<TradeRecord[]>(url);
}

export async function getTraderTrades(
  address: string,
  limit = 100
): Promise<TradeRecord[]> {
  const url = `${CLOB}/trades?maker_address=${address}&limit=${limit}`;
  try {
    return await fetchJson<TradeRecord[]>(url);
  } catch {
    return [];
  }
}

// --- Orderbook & Pricing ---

export interface OrderBook {
  market: string;
  asset_id: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  hash: string;
}

export async function getOrderBook(tokenId: string): Promise<OrderBook> {
  const url = `${CLOB}/book?token_id=${tokenId}`;
  return fetchJson<OrderBook>(url);
}

export async function getMidpoint(tokenId: string): Promise<number> {
  const url = `${CLOB}/midpoint?token_id=${tokenId}`;
  const res = await fetchJson<{ mid: string }>(url);
  return parseFloat(res.mid);
}

export async function getPriceHistory(
  conditionId: string,
  interval = "1d",
  fidelity = 60
): Promise<Array<{ t: number; p: number }>> {
  const url = `${CLOB}/prices-history?market=${conditionId}&interval=${interval}&fidelity=${fidelity}`;
  return fetchJson<Array<{ t: number; p: number }>>(url);
}
