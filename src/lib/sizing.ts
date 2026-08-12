import type { PredictionRow, SizedTrade, TradeSide } from "./types";

export type SizeInputs = {
  bankroll: number;
  riskOfRuin: number;
  minAbsDelta: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function eventDateKey(row: PredictionRow): string {
  if (row.event_datetime) {
    const d = new Date(row.event_datetime);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  const match = row.event_ticker.match(/-(\d{2}[A-Z]{3}\d{2})$/i);
  return match ? match[1].toUpperCase() : "unknown";
}

export function sideFromDelta(delta: number): TradeSide {
  return delta >= 0 ? "YES" : "NO";
}

export function costForSide(row: PredictionRow, side: TradeSide): number {
  if (side === "YES") return clamp(row.yes_ask, 0.01, 0.99);
  return clamp(1 - row.yes_bid, 0.01, 0.99);
}

export function edgeForSide(row: PredictionRow, side: TradeSide): number {
  if (side === "YES") return row.model_probability - row.yes_ask;
  return row.yes_bid - row.model_probability;
}

/**
 * Allocate bankroll across markets with |delta| >= minAbsDelta.
 * Frontend-only; Lambda publishes every market prediction.
 */
export function sizeTrades(
  predictions: PredictionRow[],
  inputs: SizeInputs,
): SizedTrade[] {
  const bankroll = Math.max(0, inputs.bankroll);
  const ror = clamp(inputs.riskOfRuin, 0.005, 0.5);
  const minAbs = Math.max(0, inputs.minAbsDelta);
  if (bankroll <= 0) return [];

  const eligible = predictions
    .filter((row) => row.abs_delta >= minAbs && Math.abs(row.delta) > 0)
    .filter((row) => {
      const side = sideFromDelta(row.delta);
      return edgeForSide(row, side) > 0;
    })
    .sort((a, b) => b.abs_delta - a.abs_delta);

  if (!eligible.length) return [];

  const weightSum = eligible.reduce((sum, row) => sum + row.abs_delta, 0);
  const maxPerTrade = bankroll * ror;
  let remaining = bankroll;

  const sized: SizedTrade[] = [];
  for (const row of eligible) {
    if (remaining < 0.5) break;
    const side = sideFromDelta(row.delta);
    const cost = costForSide(row, side);
    const edge = edgeForSide(row, side);
    const rawShare = bankroll * (row.abs_delta / weightSum);
    const dollars = Math.min(rawShare, maxPerTrade, remaining);
    const contracts = Math.floor(dollars / cost);
    if (contracts < 1) continue;
    const spent = contracts * cost;
    remaining -= spent;
    sized.push({
      row,
      side,
      cost,
      edge,
      dollars: spent,
      contracts,
      eventDate: eventDateKey(row),
    });
  }
  return sized;
}

export function groupPredictionsByDate(
  rows: PredictionRow[],
): [string, PredictionRow[]][] {
  const map = new Map<string, PredictionRow[]>();
  for (const row of rows) {
    const key = eventDateKey(row);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function groupTradesByDate(trades: SizedTrade[]): [string, SizedTrade[]][] {
  const map = new Map<string, SizedTrade[]>();
  for (const trade of trades) {
    const list = map.get(trade.eventDate) ?? [];
    list.push(trade);
    map.set(trade.eventDate, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function sortPredictionsByAbsDelta(rows: PredictionRow[]): PredictionRow[] {
  return [...rows].sort((a, b) => b.abs_delta - a.abs_delta);
}

export function sortTradesByAbsDelta(trades: SizedTrade[]): SizedTrade[] {
  return [...trades].sort((a, b) => b.row.abs_delta - a.row.abs_delta);
}

export function money(n: number): string {
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
