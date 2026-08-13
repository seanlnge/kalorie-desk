import type { MarketView, PredictionRow, SizedTrade, TradeSide } from "./types";

export type SizeInputs = {
  /** Max dollars to deploy today across selected markets. */
  dailyBankroll: number;
  /**
   * Conviction in [0, 1]. Mapped through a centered sigmoid to Kelly-mix α:
   * low → flatter (more equal) weights; high → concentrate on highest f*.
   */
  conviction: number;
  minAbsDelta: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function sigmoid(x: number): number {
  if (x >= 20) return 1;
  if (x <= -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

/**
 * Map conviction ∈ [0,1] → mix α ∈ (0,1) with a logistic curve centered at 0.5.
 * steepness≈6 tracks a classic sigmoid from near-flat to near-pure Kelly.
 */
export function convictionToMixAlpha(
  conviction: number,
  steepness = 6,
): number {
  const c = clamp(conviction, 0, 1);
  return sigmoid(steepness * (2 * c - 1));
}

export function startOfUtcDay(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const EASTERN_TZ = "America/New_York";
/** Trading day rolls at 7:00 America/New_York (EST/EDT). */
export const EASTERN_DAY_ROLL_HOUR = 7;

function zonedParts(
  now: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: num("year"),
    month: num("month"),
    day: num("day"),
    hour: num("hour"),
  };
}

function ymdKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): string {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Eastern trading "today": calendar date in America/New_York, but before
 * 07:00 still counts as the previous calendar day.
 */
export function easternTradingDateKey(now = new Date()): string {
  const { year, month, day, hour } = zonedParts(now, EASTERN_TZ);
  if (hour < EASTERN_DAY_ROLL_HOUR) {
    return addCalendarDays(year, month, day, -1);
  }
  return ymdKey(year, month, day);
}

/**
 * Target day for "Select all tomorrow": trading-today + 1 in Eastern.
 * Before 7am Eastern on calendar day D, tomorrow is still D.
 */
export function tomorrowTradeDateKey(now = new Date()): string {
  const today = easternTradingDateKey(now);
  const [y, m, d] = today.split("-").map(Number);
  return addCalendarDays(y, m, d, 1);
}

/** Alias kept for older call sites; same as tomorrowTradeDateKey. */
export function tomorrowUtcDateKey(now = new Date()): string {
  return tomorrowTradeDateKey(now);
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

/** Executable markets meeting min |delta| (same rules as Kelly sizing). */
export function pickableTradeTickers(
  markets: MarketView[],
  minAbsDelta: number,
): string[] {
  const minAbs = Math.max(0, minAbsDelta);
  return markets
    .filter(
      (m) =>
        m.side != null &&
        m.kellyFraction > 0 &&
        m.absTradeDelta >= minAbs,
    )
    .map((m) => m.market_ticker);
}

/** Tickers for executable tomorrow (Eastern 7am-roll) markets meeting min |delta|. */
export function tomorrowTradeTickers(
  markets: MarketView[],
  minAbsDelta: number,
  now = new Date(),
): string[] {
  const tomorrow = tomorrowTradeDateKey(now);
  return pickableTradeTickers(
    markets.filter((m) => m.eventDate === tomorrow),
    minAbsDelta,
  );
}

export function sameTickerSet(selected: Set<string>, tickers: string[]): boolean {
  if (!tickers.length || selected.size !== tickers.length) return false;
  return tickers.every((t) => selected.has(t));
}

/**
 * Size selected markets to spend ~dailyBankroll:
 * 1) Keep selected markets with executable edge
 * 2) Split bankroll by mix α = sigmoid(conviction): (1-α)·uniform + α·kelly
 * 3) Floor to whole contracts, then greedily spend leftover on highest-Kelly names
 */
export function sizeSelectedTrades(
  selected: MarketView[],
  inputs: SizeInputs,
): { trades: SizedTrade[]; scale: number; estimatedRoR: number } {
  const dailyBankroll = Math.max(0, inputs.dailyBankroll);
  const alpha = convictionToMixAlpha(inputs.conviction);
  const minAbs = Math.max(0, inputs.minAbsDelta);

  const candidates = selected
    .filter(
      (row) =>
        row.side &&
        row.kellyFraction > 0 &&
        row.absTradeDelta >= minAbs &&
        row.cost > 0,
    )
    .sort((a, b) => b.kellyFraction - a.kellyFraction);

  if (!candidates.length || dailyBankroll <= 0) {
    return { trades: [], scale: 0, estimatedRoR: 0 };
  }

  const fStars = candidates.map((row) => row.kellyFraction);
  const fSum = fStars.reduce((s, f) => s + f, 0);
  if (fSum <= 0) {
    return { trades: [], scale: 0, estimatedRoR: 0 };
  }

  const weights = fStars.map(
    (f) => (1 - alpha) / candidates.length + (alpha * f) / fSum,
  );
  const wSum = weights.reduce((s, w) => s + w, 0);
  const targets = candidates.map((view, i) => ({
    view,
    weight: weights[i] / wSum,
    dollarsTarget: dailyBankroll * (weights[i] / wSum),
  }));

  let remaining = dailyBankroll;
  const sized = targets.map(({ view, weight, dollarsTarget }) => {
    const cost = view.cost;
    const contracts = Math.floor(Math.min(dollarsTarget, remaining) / cost);
    const dollars = contracts * cost;
    remaining -= dollars;
    return { view, weight, cost, contracts, dollars };
  });

  // Spend leftover bankroll on highest-Kelly names (whole contracts).
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const item of sized) {
      if (remaining + 1e-9 < item.cost) continue;
      item.contracts += 1;
      item.dollars += item.cost;
      remaining -= item.cost;
      progressed = true;
      if (remaining < Math.min(...sized.map((s) => s.cost))) break;
    }
  }

  const trades: SizedTrade[] = [];
  for (const item of sized) {
    if (item.contracts < 1) continue;
    const edge = item.view.winProb - item.cost;
    trades.push({
      view: item.view,
      side: item.view.side as TradeSide,
      cost: item.cost,
      edge,
      kellyFraction: item.dollars / dailyBankroll,
      dollars: item.dollars,
      contracts: item.contracts,
      eventDate: item.view.eventDate,
      expectedRoi: edge / item.cost,
    });
  }

  const estimatedRoR = estimateRiskOfRuin(
    trades.map((t) => ({
      p: t.view.winProb,
      cost: t.cost,
      fraction: t.dollars / dailyBankroll,
    })),
  );

  return { trades, scale: alpha, estimatedRoR };
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

/** Prefer "Webull" from "What will Webull say…"; else event title / ticker. */
export function marketDisplayName(trade: SizedTrade): string {
  const title = trade.view.event_title?.trim() ?? "";
  const mention = title.match(/what will\s+(.+?)\s+say\b/i);
  if (mention?.[1]) return mention[1].trim();
  if (title) return title;
  return trade.view.event_ticker;
}

/** Group by event/market; groups + rows sorted by Kelly f (desc). */
export function groupTradesByMarket(
  trades: SizedTrade[],
): [string, SizedTrade[]][] {
  const map = new Map<string, SizedTrade[]>();
  for (const trade of trades) {
    const key = trade.view.event_ticker;
    const list = map.get(key) ?? [];
    list.push(trade);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([key, rows]) => {
      const sorted = [...rows].sort((a, b) => b.kellyFraction - a.kellyFraction);
      return [key, sorted] as [string, SizedTrade[]];
    })
    .sort((a, b) => {
      const ka = a[1][0]?.kellyFraction ?? 0;
      const kb = b[1][0]?.kellyFraction ?? 0;
      if (kb !== ka) return kb - ka;
      return marketDisplayName(a[1][0]).localeCompare(marketDisplayName(b[1][0]));
    });
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
