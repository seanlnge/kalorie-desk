import type { Snapshot } from "./types";

export async function fetchLatestSnapshot(baseUrl: string): Promise<Snapshot> {
  const url = `${baseUrl.replace(/\/$/, "")}/latest.json?t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Snapshot fetch failed (${res.status}) from ${url}`);
  }
  const data = (await res.json()) as Snapshot;
  if (!Array.isArray(data.predictions)) {
    throw new Error("Snapshot missing predictions[]");
  }
  return {
    ...data,
    predictions: data.predictions.map((row) => ({
      ...row,
      abs_delta: row.abs_delta ?? Math.abs(row.delta),
    })),
  };
}
