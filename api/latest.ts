/**
 * Vercel serverless proxy: browser -> /api/latest -> S3 latest.json
 *
 * Safety:
 * - Browser never talks to S3 directly and never sees AWS keys.
 * - Put SNAPSHOT_BASE_URL in Vercel env (server-only, not VITE_*).
 * - Prefer a private bucket + IAM credentials on the server later;
 *   public GetObject on snapshot JSON is OK only because it holds
 *   market probs (no trading keys / OpenAI secrets).
 */

const DEFAULT_BASE =
  process.env.SNAPSHOT_BASE_URL ||
  process.env.VITE_SNAPSHOT_BASE_URL ||
  "";

export default async function handler(
  _req: { method?: string },
  res: {
    status: (code: number) => {
      json: (body: unknown) => void;
      end: (body?: string) => void;
    };
    setHeader: (name: string, value: string) => void;
  },
) {
  if (!DEFAULT_BASE) {
    res.status(500).json({
      error: "SNAPSHOT_BASE_URL is not set on the server",
    });
    return;
  }

  const url = `${DEFAULT_BASE.replace(/\/$/, "")}/latest.json`;
  try {
    const upstream = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!upstream.ok) {
      res.status(upstream.status).json({
        error: `Upstream S3 returned ${upstream.status}`,
        url,
      });
      return;
    }
    const body = await upstream.text();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).end(body);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Upstream fetch failed",
    });
  }
}
