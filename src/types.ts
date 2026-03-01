// ============================================================
// Polymarket Copy-Trade Sniper — Type Definitions
// ============================================================

// --- Polymarket Raw API Types ---

export interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  conditionId: string;
  tokens: Array<{
    token_id: string;
    outcome: string;
    price: number;
  }>;
  volume: string;
  liquidity: string;
  startDate: string;
  endDate: string;
  closed: boolean;
  active: boolean;
  description: string;
  category: string;
  minimum_order_size: number;
  minimum_tick_size: number;
  negRisk: boolean;
}

export interface TraderProfile {
  address: string;
  username: string;
  profileImage?: string;
  pnl: number;
  volume: number;
  marketsTraded: number;
  rank: number;
  winRate: number;
}

export interface TraderPosition {
  user: string;
  conditionId: string;
  tokenId: string;
  outcome: string; // "Yes" | "No"
  size: string;
  avgPrice: string;
  currentPrice: string;
  pnl: string;
  title?: string;
  slug?: string;
  market?: GammaMarket;
}

export interface TradeRecord {
  id: string;
  taker_order_id: string;
  market: string;
  asset_id: string;
  side: "BUY" | "SELL";
  size: string;
  price: string;
  timestamp: string;
  owner: string;
  outcome: string;
}

// --- Bot Internal Types ---

export type TradeDirection = "YES" | "NO";

export interface TrackedTrader {
  profile: TraderProfile;
  positions: TraderPosition[];
  recentTrades: TradeRecord[];
  lastScanned: Date;
}

export interface OverlappingTrade {
  conditionId: string;
  market: GammaMarket;
  direction: TradeDirection;
  traders: Array<{
    address: string;
    username: string;
    position: TraderPosition;
    entryPrice: number;
  }>;
  traderCount: number;
  avgEntryPrice: number;
  currentPrice: number;
  isHedged: boolean; // true if traders are split on direction
  hedgeRatio: number; // 0-1, ratio of minority direction
  detectedAt: Date;
}

export interface TradePrediction {
  id: string;
  overlappingTrade: OverlappingTrade;
  direction: TradeDirection;
  confidence: number; // 0-100
  entryPrice: number;
  targetPrice: number;
  expectedReturn: number; // percentage
  budgetAllocation: number; // USDC amount
  status: "pending" | "researching" | "qualified" | "disqualified" | "executing" | "active" | "closed";
  research?: AgentResearch;
  createdAt: Date;
}

export interface AgentResearch {
  predictionId: string;
  sources: ResearchSource[];
  confidenceScore: number; // 0-100
  rationale: string;
  qualifyingFactors: string[];
  disqualifyingFactors: string[];
  recommendation: "strong_buy" | "buy" | "hold" | "avoid" | "strong_avoid";
  tradeHorizon: "ultra_short" | "short_term" | "mid_term" | "long_term";
  completedAt: Date;
}

export interface ResearchSource {
  url: string;
  title: string;
  summary: string;
  sentiment: "bullish" | "bearish" | "neutral";
  relevanceScore: number; // 0-100
}

// --- Dashboard Stats ---

export interface DashboardStats {
  // Scanner stats
  totalMarketsScanned: number;
  activeMarkets: number;
  topTradersTracked: number;
  lastScanTime: Date;

  // Signal stats
  overlappingTradesFound: number;
  qualifiedPredictions: number;
  disqualifiedPredictions: number;
  hedgedTradesFiltered: number;

  // Performance
  totalBudget: number;
  allocatedBudget: number;
  remainingBudget: number;
  activePredictions: number;

  // Historical (once we start trading)
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  hitRate: number; // percentage
  totalPnL: number;
  avgReturnPerTrade: number;

  // Current batch
  currentBatch: TradePrediction[];
  scanCycleCount: number;
}

// --- Config ---

export interface BotConfig {
  // Polymarket
  clobHost: string;
  gammaHost: string;
  chainId: number;
  privateKey: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  funderAddress: string;

  // Bot params
  budgetUsdc: number;
  minOverlapTraders: number;
  maxHedgeRatio: number;
  scanIntervalMs: number;
  topTradersCount: number;
  topTradesCount: number;

  // Anthropic
  anthropicApiKey: string;
}
