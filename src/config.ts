import dotenv from "dotenv";
import { BotConfig } from "./types.js";

dotenv.config();

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing env var: ${key}`);
  return val;
}

export const config: BotConfig = {
  // Polymarket endpoints
  clobHost: "https://clob.polymarket.com",
  gammaHost: "https://gamma-api.polymarket.com",
  chainId: 137, // Polygon

  // Auth (optional for read-only mode)
  privateKey: process.env.POLYMARKET_PRIVATE_KEY ?? "",
  apiKey: process.env.POLYMARKET_API_KEY ?? "",
  apiSecret: process.env.POLYMARKET_API_SECRET ?? "",
  apiPassphrase: process.env.POLYMARKET_API_PASSPHRASE ?? "",
  funderAddress: process.env.POLYMARKET_FUNDER_ADDRESS ?? "",

  // Bot params
  budgetUsdc: Number(env("BUDGET_USDC", "100")),
  minOverlapTraders: Number(env("MIN_OVERLAP_TRADERS", "4")),
  maxHedgeRatio: Number(env("MAX_HEDGE_RATIO", "0.2")),
  scanIntervalMs: Number(env("SCAN_INTERVAL_MS", "60000")),
  topTradersCount: Number(env("TOP_TRADERS_COUNT", "20")),
  topTradesCount: Number(env("TOP_TRADES_COUNT", "5")),

  // Anthropic
  anthropicApiKey: env("ANTHROPIC_API_KEY", ""),
};
