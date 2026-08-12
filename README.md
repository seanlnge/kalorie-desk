# Kalorie Desk

Reads Kalorie S3 snapshots and shows **every** scored market. Trade sizing (side / contracts / $) is computed only in the browser from bankroll + risk of ruin.

## How data is pulled (important for Vercel)

```text
Browser  -->  GET /api/latest  -->  S3 latest.json
              (same origin)         (server / Vite proxy)
```

- The browser **never** calls S3 directly and **never** needs AWS keys.
- Locally, Vite proxies `/api/latest` → `{VITE_SNAPSHOT_BASE_URL}/latest.json`.
- On Vercel, [`api/latest.ts`](api/latest.ts) does the same using **server** env `SNAPSHOT_BASE_URL`.

### Env vars

| Where | Name | Notes |
|-------|------|--------|
| Local `.env` | `VITE_SNAPSHOT_BASE_URL` | Public S3 base URL (used by Vite proxy only) |
| Vercel | `SNAPSHOT_BASE_URL` | Same URL, **server-only** (do not prefix `VITE_`) |

Never put `AWS_ACCESS_KEY_ID` / secrets in `VITE_*` vars (those are baked into the client bundle).

### Safety model today

Snapshot objects are public-read JSON (market probs + model deltas). That is intentional for a simple desk. They do **not** contain OpenAI or Kalshi trading keys.

Hardening later (optional):

1. Make the S3 bucket private again.
2. Give the Vercel function an IAM user/role with `s3:GetObject` on that bucket only.
3. Keep the browser on `/api/latest` only.

## Run locally

```bash
npm install
cp .env.example .env
# VITE_SNAPSHOT_BASE_URL=https://<bucket>.s3.us-east-2.amazonaws.com
npm run dev
```

Open http://localhost:5173/ — you should see **All markets** (hundreds of rows). **Sized trades** is a separate tab.

## Lambda contract

Every open earnings-mention market is scored and written. No trade filtering in Lambda.

`GET {base}/latest.json` also mirrored as `{yyyymmddHH}.json`.

```json
{
  "snapshot_id": "2026081206",
  "predictions": [
    {
      "market_ticker": "...",
      "event_ticker": "...",
      "event_title": "...",
      "target_phrase": "AI",
      "model_probability": 0.28,
      "market_probability": 0.35,
      "yes_bid": 0.33,
      "yes_ask": 0.37,
      "residual_delta": -0.07,
      "delta": -0.07,
      "abs_delta": 0.07,
      "prediction_eligible": true,
      "volume": 12
    }
  ]
}
```

No `side` / stake fields from Lambda.
