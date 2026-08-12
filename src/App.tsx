import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwise,
  CalendarBlank,
  ChartLineUp,
  UploadSimple,
} from "@phosphor-icons/react";
import { fetchLatestSnapshot } from "./lib/fetchSnapshot";
import {
  groupByDate,
  money,
  pct,
  sizeTrades,
  sortByAbsDelta,
} from "./lib/sizing";
import type { Snapshot } from "./lib/types";

type ViewMode = "delta" | "date";

const DEFAULT_BASE = import.meta.env.VITE_SNAPSHOT_BASE_URL ?? "";

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [bankroll, setBankroll] = useState(500);
  const [riskOfRuin, setRiskOfRuin] = useState(0.05);
  const [minAbsDelta, setMinAbsDelta] = useState(0.03);
  const [view, setView] = useState<ViewMode>("delta");

  async function loadRemote() {
    if (!DEFAULT_BASE) {
      setError("Set VITE_SNAPSHOT_BASE_URL in .env");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchLatestSnapshot(DEFAULT_BASE));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load snapshot");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRemote();
  }, []);

  function onUpload(file: File | null) {
    if (!file) return;
    setLoading(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as Snapshot;
        if (!Array.isArray(data.predictions)) {
          throw new Error("JSON missing predictions[]");
        }
        setSnapshot({
          ...data,
          predictions: data.predictions.map((row) => ({
            ...row,
            abs_delta: row.abs_delta ?? Math.abs(row.delta),
          })),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid JSON");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  }

  const trades = useMemo(
    () =>
      snapshot
        ? sizeTrades(snapshot.predictions, {
            bankroll,
            riskOfRuin,
            minAbsDelta,
          })
        : [],
    [snapshot, bankroll, riskOfRuin, minAbsDelta],
  );

  const totalStake = trades.reduce((sum, t) => sum + t.dollars, 0);
  const byDelta = sortByAbsDelta(trades);
  const byDate = groupByDate(trades);

  return (
    <div className="mx-auto min-h-[100dvh] max-w-5xl px-4 py-8 md:px-6 md:pt-10">
      <header className="mb-10 flex flex-col gap-4 border-b border-slate-200 pb-8 dark:border-slate-800 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium tracking-tight text-emerald-700 dark:text-emerald-400">
            Kalorie Desk
          </p>
          <h1 className="mt-1 max-w-xl text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 md:text-4xl">
            Tomorrow&apos;s mention bets
          </h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Size trades from live model deltas. Risk of ruin caps each name;
            bankroll is split by |delta|.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadRemote()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-50 dark:bg-emerald-600"
          >
            <ArrowClockwise size={16} weight="bold" />
            Refresh
          </button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <UploadSimple size={16} />
            Load JSON
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => onUpload(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>
      </header>

      <section className="mb-8 grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-500">
            Total bankroll ($)
          </span>
          <input
            type="number"
            min={0}
            step={10}
            value={bankroll}
            onChange={(e) => setBankroll(Number(e.target.value) || 0)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-500">
            Risk of ruin (max fraction / trade)
          </span>
          <input
            type="number"
            min={0.005}
            max={0.5}
            step={0.005}
            value={riskOfRuin}
            onChange={(e) => setRiskOfRuin(Number(e.target.value) || 0)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-500">
            Min |delta|
          </span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.005}
            value={minAbsDelta}
            onChange={(e) => setMinAbsDelta(Number(e.target.value) || 0)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
      </section>

      {error ? (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          {error}
        </p>
      ) : null}

      {snapshot ? (
        <div className="mb-6 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
          <span>
            Snapshot{" "}
            <span className="font-medium text-slate-800 dark:text-slate-200">
              {snapshot.snapshot_id}
            </span>
          </span>
          <span>{snapshot.model_name}</span>
          <span>{snapshot.prediction_count} markets</span>
          <span>
            {trades.length} trades · {money(totalStake)} allocated
          </span>
        </div>
      ) : (
        <p className="mb-6 text-sm text-slate-500">
          {loading ? "Loading snapshot…" : "No snapshot loaded yet."}
        </p>
      )}

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-950">
        <button
          type="button"
          onClick={() => setView("delta")}
          className={`inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
            view === "delta"
              ? "bg-emerald-600 text-white"
              : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900"
          }`}
        >
          <ChartLineUp size={16} weight="bold" />
          Highest delta
        </button>
        <button
          type="button"
          onClick={() => setView("date")}
          className={`inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
            view === "date"
              ? "bg-emerald-600 text-white"
              : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900"
          }`}
        >
          <CalendarBlank size={16} weight="bold" />
          By event date
        </button>
      </div>

      {view === "delta" ? (
        <TradeTable trades={byDelta} />
      ) : (
        <div className="space-y-8">
          {byDate.map(([date, rows]) => (
            <div key={date}>
              <h2 className="mb-3 text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                {date}
                <span className="ml-2 font-normal text-slate-400">
                  {rows.length} trades ·{" "}
                  {money(rows.reduce((s, t) => s + t.dollars, 0))}
                </span>
              </h2>
              <TradeTable trades={sortByAbsDelta(rows)} />
            </div>
          ))}
          {!byDate.length ? (
            <p className="text-sm text-slate-500">No trades under these filters.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TradeTable({
  trades,
}: {
  trades: ReturnType<typeof sizeTrades>;
}) {
  if (!trades.length) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700">
        No positive-edge trades under these filters.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-950/60">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
            <th className="px-3 py-3 font-medium">Market</th>
            <th className="px-3 py-3 font-medium">Side</th>
            <th className="px-3 py-3 font-medium">Delta</th>
            <th className="px-3 py-3 font-medium">Edge</th>
            <th className="px-3 py-3 font-medium">Cost</th>
            <th className="px-3 py-3 font-medium">Contracts</th>
            <th className="px-3 py-3 font-medium">Stake</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr
              key={t.row.market_ticker}
              className="border-b border-slate-100 last:border-0 dark:border-slate-900"
            >
              <td className="px-3 py-3 align-top">
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  {t.row.target_phrase}
                </div>
                <div className="mt-0.5 max-w-xs truncate text-xs text-slate-400">
                  {t.row.event_title || t.row.event_ticker}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                  {t.row.market_ticker}
                </div>
              </td>
              <td className="px-3 py-3 align-top">
                <span
                  className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${
                    t.side === "YES"
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                  }`}
                >
                  {t.side}
                </span>
              </td>
              <td className="px-3 py-3 align-top font-mono tabular-nums">
                {t.row.delta >= 0 ? "+" : ""}
                {t.row.delta.toFixed(3)}
              </td>
              <td className="px-3 py-3 align-top font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {pct(t.edge)}
              </td>
              <td className="px-3 py-3 align-top font-mono tabular-nums">
                {t.cost.toFixed(2)}
              </td>
              <td className="px-3 py-3 align-top font-mono tabular-nums">
                {t.contracts}
              </td>
              <td className="px-3 py-3 align-top font-semibold tabular-nums">
                {money(t.dollars)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
