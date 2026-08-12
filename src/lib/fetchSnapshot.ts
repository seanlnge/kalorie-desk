import type { Snapshot } from "./types";

/**
 * Always fetch same-origin `/api/latest`.
 * - Local: Vite proxies to S3 (see vite.config.ts)
 * - Vercel: api/latest.ts proxies to S3 with server env
 *
 * Do not put AWS access keys in VITE_* vars.
 */
export async function fetchLatestSnapshot(): Promise<Snapshot> {
  const res = await fetch(`/api/latest?t=${Date.now()}`);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Snapshot fetch failed (${res.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const data = (await res.json()) as Snapshot;
  if (!Array.isArray(data.predictions)) {
    throw new Error("Snapshot missing predictions[]");
  }
  return data;
}
