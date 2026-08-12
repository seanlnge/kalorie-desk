export type PredictionRow = {
  market_ticker: string;
  event_ticker: string;
  event_datetime: string | null;
  event_title: string;
  target_phrase: string;
  model_name: string;
  model_probability: number;
  market_probability: number;
  yes_bid: number;
  yes_ask: number;
  /** Model residual (from Lambda); not the trade-edge delta. */
  residual_delta?: number;
  delta?: number;
  abs_delta?: number;
  volume: number;
  prediction_eligible?: boolean | null;
};

export type Snapshot = {
  snapshot_id: string;
  generated_at: string;
  model_name: string;
  market_count: number;
  prediction_count: number;
  markets: unknown[];
  predictions: PredictionRow[];
};

export type TradeSide = "YES" | "NO";

/** Enriched row with executable trade-edge delta (YES vs bid / NO vs ask). */
export type MarketView = PredictionRow & {
  eventDate: string;
  side: TradeSide | null;
  /** Trade edge delta used for sorting / Kelly. */
  tradeDelta: number;
  absTradeDelta: number;
  cost: number;
  winProb: number;
  kellyFraction: number;
  past: boolean;
};

export type SizedTrade = {
  view: MarketView;
  side: TradeSide;
  cost: number;
  edge: number;
  kellyFraction: number;
  dollars: number;
  contracts: number;
  eventDate: string;
  expectedRoi: number;
};
