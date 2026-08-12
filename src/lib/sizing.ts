import type { MarketView, PredictionRow, SizedTrade, TradeSide } from "./types";

export type SizeInputs = {
  /** Max dollars to deploy today across selected markets. */
  dailyBankroll: number;
  /** Max number of selected markets to fund today. */
  maxMarkets: number;
  /**
   * Target long-run bankruptcy probability (0-1).
   * Stakes are scaled (fractional Kelly) so estimated RoR <= this.
   */
  riskOfRuin: number;
  minAbsDelta: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** YYYY-MM-DD for tomorrow in UTC. */
export function tomorrowUtcDateKey(now = new Date()): string {
  const day = startOfUtcDay(now);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

export function eventDateKey(row: PredictionRow): string {
  if (row.event_datetime) {
    const d = new Date(row.event_datetime);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  const match = row.event_ticker.match(/-(\d{2}[A-Z]{3}\d{2})$/i);
  if (!match) return "unknown";
  // 26JUL24 → 2026-07-24
  const raw = match[1].toUpperCase();
  const months: Record<string, string> = {
    JAN: "01",
    FEB: "02",
    MAR: "03",
    APR: "04",
    MAY: "05",
    JUN: "06",
    JUL: "07",
    AUG: "08",
    SEP: "09",
    OCT: "10",
    NOV: "11",
    DEC: "12",
  };
  const yy = raw.slice(0, 2);
  const mon = months[raw.slice(2, 5)];
  const dd = raw.slice(5, 7);
  if (!mon) return raw;
  return `20${yy}-${mon}-${dd}`;
}

export function isPastEvent(row: PredictionRow, now = new Date()): boolean {
  const key = eventDateKey(row);
  if (key === "unknown") return false;
  const eventDay = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(eventDay.getTime())) return false;
  return eventDay < startOfUtcDay(now);
}

/**
 * Trade delta:
 * - YES vs bid when model > yes_bid:  model - yes_bid
 * - NO vs ask when model < yes_ask:   (1-model) - no_ask = yes_bid - model
 *   (NO ask on Kalshi = 1 - yes_bid)
 * If both apply, pick the larger positive edge; require executable edge vs ask/bid.
 */
export function enrichMarket(row: PredictionRow, now = new Date()): MarketView {
  const model = clamp(row.model_probability, 0.001, 0.999);
  const yesBid = clamp(row.yes_bid, 0.01, 0.99);
  const yesAsk = clamp(row.yes_ask, 0.01, 0.99);

  // Display / sort delta per product rule:
  // - YES vs bid when model > yes_bid
  // - NO vs ask when model < yes_ask (NO ask = 1 - yes_bid)
  const yesVsBid = model > yesBid ? model - yesBid : -Infinity;
  const noVsAsk = model < yesAsk ? yesBid - model : -Infinity;

  let side: TradeSide | null = null;
  let tradeDelta = 0;
  if (yesVsBid > 0 || noVsAsk > 0) {
    if (yesVsBid >= noVsAsk && yesVsBid > 0) {
      side = "YES";
      tradeDelta = yesVsBid;
    } else if (noVsAsk > 0) {
      side = "NO";
      tradeDelta = noVsAsk;
    }
  }

  // Kelly uses executable prices: buy YES at ask, buy NO at (1 - bid).
  let cost = 0;
  let winProb = 0;
  let kellyFraction = 0;
  if (side === "YES" && model > yesAsk) {
    cost = yesAsk;
    winProb = model;
    kellyFraction = (winProb - cost) / (1 - cost);
  } else if (side === "NO" && model < yesBid) {
    cost = 1 - yesBid;
    winProb = 1 - model;
    kellyFraction = (winProb - cost) / (1 - cost);
  } else if (side === "YES") {
    cost = yesAsk;
    winProb = model;
  } else if (side === "NO") {
    cost = 1 - yesBid;
    winProb = 1 - model;
  }
  return {
    ...row,
    eventDate: eventDateKey(row),
    side,
    tradeDelta,
    absTradeDelta: Math.abs(tradeDelta),
    cost,
    winProb,
    kellyFraction,
    past: isPastEvent(row, now),
  };
}

export function activeMarkets(
  rows: PredictionRow[],
  now = new Date(),
): MarketView[] {
  return rows
    .map((row) => enrichMarket(row, now))
    .filter((row) => !row.past);
}

/** Expected return and variance of ΔW/W for a binary contract stake fraction f. */
function betMoments(p: number, cost: number, f: number): { mu: number; var: number } {
  if (f <= 0 || cost <= 0 || cost >= 1) return { mu: 0, var: 0 };
  const winRet = f * ((1 - cost) / cost); // profit / bankroll on win
  const loseRet = -f;
  const mu = p * winRet + (1 - p) * loseRet;
  const second = p * winRet * winRet + (1 - p) * loseRet * loseRet;
  const variance = Math.max(0, second - mu * mu);
  return { mu, var: variance };
}

/**
 * Long-run bankruptcy probability under continuous approximation:
 * P(ruin) ≈ exp(-2 μ / σ²) for multiplicative wealth with per-period
 * drift μ and variance σ² (independent bets summed).
 */
export function estimateRiskOfRuin(
  bets: { p: number; cost: number; fraction: number }[],
): number {
  let mu = 0;
  let variance = 0;
  for (const bet of bets) {
    const m = betMoments(bet.p, bet.cost, bet.fraction);
    mu += m.mu;
    variance += m.var;
  }
  if (mu <= 0) return 1;
  if (variance <= 1e-12) return 0;
  return clamp(Math.exp((-2 * mu) / variance), 0, 1);
}

/**
 * Kelly-optimize selected markets:
 * 1) Keep top `maxMarkets` by full-Kelly fraction (edge quality)
 * 2) Binary-search fractional Kelly scale so estimated RoR ≤ target
 * 3) Cap total dollars at dailyBankroll
 */
export function sizeSelectedTrades(
  selected: MarketView[],
  inputs: SizeInputs,
): { trades: SizedTrade[]; scale: number; estimatedRoR: number } {
  const dailyBankroll = Math.max(0, inputs.dailyBankroll);
  const maxMarkets = Math.max(1, Math.floor(inputs.maxMarkets));
  const targetRoR = clamp(inputs.riskOfRuin, 0.0001, 0.99);
  const minAbs = Math.max(0, inputs.minAbsDelta);

  const candidates = selected
    .filter(
      (row) =>
        row.side &&
        row.kellyFraction > 0 &&
        row.absTradeDelta >= minAbs &&
        row.cost > 0,
    )
    .sort((a, b) => b.kellyFraction - a.kellyFraction)
    .slice(0, maxMarkets);

  if (!candidates.length || dailyBankroll <= 0) {
    return { trades: [], scale: 0, estimatedRoR: 0 };
  }

  const fullKelly = candidates.map((row) => ({
    view: row,
    fStar: row.kellyFraction,
  }));

  const rorAt = (scale: number): number =>
    estimateRiskOfRuin(
      fullKelly.map(({ view, fStar }) => ({
        p: view.winProb,
        cost: view.cost,
        fraction: scale * fStar,
      })),
    );

  // Binary search largest scale in (0,1] with RoR <= target
  let lo = 0;
  let hi = 1;
  let best = 0;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (rorAt(mid) <= targetRoR) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // If even tiny scale exceeds RoR (almost never), fall back to tiny stake
  let scale = best;
  if (scale <= 0 && rorAt(1e-6) <= targetRoR) scale = 1e-6;

  let remaining = dailyBankroll;
  const trades: SizedTrade[] = [];
  // First pass: uncapped kelly dollars, then rescale to bankroll
  const raw = fullKelly.map(({ view, fStar }) => {
    const fraction = scale * fStar;
    return { view, fraction, dollars: dailyBankroll * fraction };
  });
  const rawSum = raw.reduce((s, r) => s + r.dollars, 0);
  const bankrollScale = rawSum > dailyBankroll ? dailyBankroll / rawSum : 1;

  for (const item of raw) {
    const dollarsTarget = item.dollars * bankrollScale;
    const cost = item.view.cost;
    const contracts = Math.floor(Math.min(dollarsTarget, remaining) / cost);
    if (contracts < 1) continue;
    const dollars = contracts * cost;
    remaining -= dollars;
    const edge = item.view.winProb - cost;
    trades.push({
      view: item.view,
      side: item.view.side as TradeSide,
      cost,
      edge,
      kellyFraction: item.fraction * bankrollScale,
      dollars,
      contracts,
      eventDate: item.view.eventDate,
      expectedRoi: edge / cost,
    });
  }

  const estimatedRoR = estimateRiskOfRuin(
    trades.map((t) => ({
      p: t.view.winProb,
      cost: t.cost,
      fraction: t.dollars / dailyBankroll,
    })),
  );

  return { trades, scale: scale * bankrollScale, estimatedRoR };
}

export function groupMarketsByEvent(
  rows: MarketView[],
): [string, MarketView[]][] {
  const map = new Map<string, MarketView[]>();
  for (const row of rows) {
    const list = map.get(row.event_ticker) ?? [];
    list.push(row);
    map.set(row.event_ticker, list);
  }
  return [...map.entries()].sort((a, b) => {
    const da = a[1][0]?.eventDate ?? "";
    const db = b[1][0]?.eventDate ?? "";
    if (da !== db) return da.localeCompare(db);
    return a[0].localeCompare(b[0]);
  });
}

export function groupMarketsByDate(
  rows: MarketView[],
): [string, MarketView[]][] {
  const map = new Map<string, MarketView[]>();
  for (const row of rows) {
    const list = map.get(row.eventDate) ?? [];
    list.push(row);
    map.set(row.eventDate, list);
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

export function sortByTradeDelta(rows: MarketView[]): MarketView[] {
  return [...rows].sort((a, b) => b.absTradeDelta - a.absTradeDelta);
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
