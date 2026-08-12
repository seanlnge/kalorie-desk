import { describe, expect, it } from "vitest";
import { enrichMarket, sizeSelectedTrades } from "./sizing";
import { outcomeDistribution, pnlPercentile } from "./outcomeDist";
import type { PredictionRow, SizedTrade } from "./types";

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

describe("outcomeDistribution", () => {
  it("matches two-outcome EV for a single trade", () => {
    const view = enrichMarket(
      row({
        market_ticker: "A",
        model_probability: 0.7,
        yes_bid: 0.3,
        yes_ask: 0.4,
      }),
    );
    const { trades } = sizeSelectedTrades([view], {
      dailyBankroll: 40,
      conviction: 0.7,
      minAbsDelta: 0.01,
    });
    expect(trades.length).toBe(1);
    const trade = trades[0] as SizedTrade;
    const summary = outcomeDistribution([trade]);
    const win = trade.contracts * (1 - trade.cost);
    const lose = -trade.dollars;
    const p = trade.view.winProb;
    const ev = p * win + (1 - p) * lose;
    expect(summary.expectedPnl).toBeCloseTo(ev, 6);
    expect(summary.points).toHaveLength(2);
    expect(summary.p10).toBeCloseTo(lose, 2);
    expect(summary.p90).toBeCloseTo(win, 2);
    expect(
      pnlPercentile(
        [
          { pnl: -10, probability: 0.4 },
          { pnl: 5, probability: 0.6 },
        ],
        0.5,
      ),
    ).toBe(5);
  });
});
