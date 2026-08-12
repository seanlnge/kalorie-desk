# Kalorie Desk

Tiny React app that reads Kalorie S3 snapshots and sizes tomorrow's trades from model **delta**.

Lambda only publishes probabilities + delta. This app decides side, stake, and contracts from:

- **Total bankroll** – dollars available for the day
- **Risk of ruin** – max fraction of bankroll on any single market
- **Min |delta|** – ignore smaller residual gaps

## Setup

```bash
npm install
cp .env.example .env
# set VITE_SNAPSHOT_BASE_URL to KaloriePollerStack.SnapshotPublicBaseUrl
npm run dev
```

Or use **Load JSON** with a downloaded `latest.json` / `yyyymmddHH.json`.

## Views

- **Highest delta** – trades sorted by `|delta|`
- **By event date** – same trades grouped by event day

## Snapshot contract

`GET {base}/latest.json`

```json
{
  "snapshot_id": "2026081205",
  "predictions": [
    {
      "market_ticker": "...",
      "event_ticker": "...",
      "event_datetime": "...",
      "target_phrase": "AI",
      "model_probability": 0.28,
      "market_probability": 0.35,
      "yes_bid": 0.33,
      "yes_ask": 0.37,
      "delta": -0.07,
      "abs_delta": 0.07
    }
  ]
}
```

No `side` / `edge` / `trade_count` from Lambda. Those are computed here.
