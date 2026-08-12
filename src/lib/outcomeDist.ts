import type { SizedTrade } from "./types";

export type OutcomePoint = {
  /** Net P&L in dollars (rounded to cents). */
  pnl: number;
  probability: number;
};

export type OutcomeSummary = {
  points: OutcomePoint[];
  expectedPnl: number;
  worstPnl: number;
  bestPnl: number;
  /** Inverse-CDF percentiles of the P&L distribution. */
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  probProfit: number;
  probLoss: number;
  /** Stdev of P&L under independent binary outcomes. */
  stdevPnl: number;
};

/** Smallest PnL such that cumulative probability ≥ q (q in 0..1). */
export function pnlPercentile(points: OutcomePoint[], q: number): number {
  if (!points.length) return 0;
  const target = Math.min(1, Math.max(0, q));
  let cdf = 0;
  for (const pt of points) {
    cdf += pt.probability;
    if (cdf + 1e-12 >= target) return pt.pnl;
  }
  return points[points.length - 1].pnl;
}

function winPnl(trade: SizedTrade): number {
  // Win pays $1/contract; stake was cost * contracts.
  return trade.contracts * (1 - trade.cost);
}

function losePnl(trade: SizedTrade): number {
  return -trade.dollars;
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Exact P&L distribution for independent binary trades (DP over cents).
 * Caps at 16 trades (~65k leaves); larger books use Monte Carlo.
 */
export function outcomeDistribution(
  trades: SizedTrade[],
  opts?: { mcDraws?: number },
): OutcomeSummary {
  const active = trades.filter((t) => t.contracts >= 1 && t.dollars > 0);
  if (!active.length) {
    return {
      points: [],
      expectedPnl: 0,
      worstPnl: 0,
      bestPnl: 0,
      p10: 0,
      p25: 0,
      p75: 0,
      p90: 0,
      probProfit: 0,
      probLoss: 0,
      stdevPnl: 0,
    };
  }

  const expectedPnl = active.reduce((sum, t) => {
    const p = t.view.winProb;
    return sum + p * winPnl(t) + (1 - p) * losePnl(t);
  }, 0);

  const variance = active.reduce((sum, t) => {
    const p = t.view.winProb;
    const w = winPnl(t);
    const l = losePnl(t);
    const mu = p * w + (1 - p) * l;
    return sum + (p * (w - mu) ** 2 + (1 - p) * (l - mu) ** 2);
  }, 0);

  const points =
    active.length <= 16
      ? exactDistribution(active)
      : monteCarloDistribution(active, opts?.mcDraws ?? 20_000);

  let probProfit = 0;
  let probLoss = 0;
  for (const pt of points) {
    if (pt.pnl > 0) probProfit += pt.probability;
    else if (pt.pnl < 0) probLoss += pt.probability;
  }

  return {
    points,
    expectedPnl,
    worstPnl: points[0]?.pnl ?? 0,
    bestPnl: points[points.length - 1]?.pnl ?? 0,
    p10: pnlPercentile(points, 0.1),
    p25: pnlPercentile(points, 0.25),
    p75: pnlPercentile(points, 0.75),
    p90: pnlPercentile(points, 0.9),
    probProfit,
    probLoss,
    stdevPnl: Math.sqrt(Math.max(0, variance)),
  };
}

function exactDistribution(trades: SizedTrade[]): OutcomePoint[] {
  // Map: cents -> probability
  let mass = new Map<number, number>([[0, 1]]);
  for (const trade of trades) {
    const p = Math.min(1, Math.max(0, trade.view.winProb));
    const w = Math.round(winPnl(trade) * 100);
    const l = Math.round(losePnl(trade) * 100);
    const next = new Map<number, number>();
    for (const [cents, prob] of mass) {
      next.set(cents + w, (next.get(cents + w) ?? 0) + prob * p);
      next.set(cents + l, (next.get(cents + l) ?? 0) + prob * (1 - p));
    }
    mass = next;
  }
  return [...mass.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cents, probability]) => ({
      pnl: cents / 100,
      probability,
    }));
}

function monteCarloDistribution(
  trades: SizedTrade[],
  draws: number,
): OutcomePoint[] {
  const counts = new Map<number, number>();
  for (let i = 0; i < draws; i += 1) {
    let pnl = 0;
    for (const trade of trades) {
      const p = Math.min(1, Math.max(0, trade.view.winProb));
      pnl += Math.random() < p ? winPnl(trade) : losePnl(trade);
    }
    const key = Math.round(pnl * 100);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cents, n]) => ({
      pnl: cents / 100,
      probability: n / draws,
    }));
}

export function binOutcomePoints(
  points: OutcomePoint[],
  binCount: number,
): OutcomePoint[] {
  if (!points.length || binCount < 2) return points;
  const lo = points[0].pnl;
  const hi = points[points.length - 1].pnl;
  if (hi <= lo) return points;
  const width = (hi - lo) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    pnl: roundCents(lo + (i + 0.5) * width),
    probability: 0,
  }));
  for (const pt of points) {
    let idx = Math.floor((pt.pnl - lo) / width);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx].probability += pt.probability;
  }
  return bins;
}
