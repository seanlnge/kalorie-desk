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
  /** Alias of residual_delta from the saved model. */
  delta: number;
  residual_delta?: number;
  abs_delta: number;
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

export type SizedTrade = {
  row: PredictionRow;
  side: TradeSide;
  cost: number;
  edge: number;
  dollars: number;
  contracts: number;
  eventDate: string;
};
