import { describe, expect, it } from "vitest";
import {
  enrichMarket,
  estimateRiskOfRuin,
  isPastEvent,
  sizeSelectedTrades,
} from "./sizing";
import type { PredictionRow } from "./types";

function row(partial: Partial<PredictionRow>): PredictionRow {
  return {
    market_ticker: "T",
    event_ticker: "E-26AUG20",
    event_datetime: "2026-08-20T00:00:00Z",
    event_title: "Test",
    target_phrase: "AI",
    model_name: "kalorie-v6",
    model_probability: 0.5,
    market_probability: 0.5,
    yes_bid: 0.4,
    yes_ask: 0.45,
    volume: 1,
    ...partial,
  };
}

describe("enrichMarket", () => {
  it("uses yes vs bid when model > bid", () => {
    const view = enrichMarket(
      row({ model_probability: 0.55, yes_bid: 0.4, yes_ask: 0.42 }),
    );
    expect(view.side).toBe("YES");
    expect(view.tradeDelta).toBeCloseTo(0.15, 5);
  });

  it("uses no vs ask when model < ask", () => {
    const view = enrichMarket(
      row({ model_probability: 0.3, yes_bid: 0.4, yes_ask: 0.5 }),
    );
    expect(view.side).toBe("NO");
    // noAsk = 1-0.4=0.6; modelNO=0.7; delta = 0.7-0.6 = 0.1 = yes_bid - model
    expect(view.tradeDelta).toBeCloseTo(0.1, 5);
  });
});

describe("isPastEvent", () => {
  it("filters prior UTC days", () => {
    const past = row({ event_datetime: "2026-07-24T00:00:00Z" });
    const now = new Date("2026-08-12T12:00:00Z");
    expect(isPastEvent(past, now)).toBe(true);
  });
});

describe("sizeSelectedTrades", () => {
  it("respects max markets and bankroll", () => {
    const views = [
      enrichMarket(
        row({
          market_ticker: "A",
          model_probability: 0.7,
          yes_bid: 0.3,
          yes_ask: 0.35,
        }),
      ),
      enrichMarket(
        row({
          market_ticker: "B",
          model_probability: 0.65,
          yes_bid: 0.3,
          yes_ask: 0.35,
        }),
      ),
      enrichMarket(
        row({
          market_ticker: "C",
          model_probability: 0.6,
          yes_bid: 0.3,
          yes_ask: 0.35,
        }),
      ),
    ];
    const { trades, estimatedRoR } = sizeSelectedTrades(views, {
      dailyBankroll: 100,
      maxMarkets: 2,
      riskOfRuin: 0.2,
      minAbsDelta: 0.01,
    });
    expect(trades.length).toBeLessThanOrEqual(2);
    expect(trades.reduce((s, t) => s + t.dollars, 0)).toBeLessThanOrEqual(100);
    expect(estimatedRoR).toBeLessThanOrEqual(0.2 + 1e-6);
  });
});

describe("estimateRiskOfRuin", () => {
  it("is high when expected drift is non-positive", () => {
    expect(
      estimateRiskOfRuin([{ p: 0.4, cost: 0.5, fraction: 0.1 }]),
    ).toBe(1);
  });
});
