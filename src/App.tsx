import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretRight,
  ChartLineUp,
  CalendarBlank,
  UploadSimple,
} from "@phosphor-icons/react";
import { fetchLatestSnapshot } from "./lib/fetchSnapshot";
import {
  activeMarkets,
  groupMarketsByDate,
  groupMarketsByEvent,
  groupTradesByDate,
  money,
  pct,
  sizeSelectedTrades,
  sortByTradeDelta,
  tomorrowUtcDateKey,
} from "./lib/sizing";
import type { MarketView, Snapshot } from "./lib/types";

type ViewMode = "delta" | "date";
type Panel = "markets" | "trades";

function readNumber(
  value: string,
  fallback: number,
  opts?: { min?: number; max?: number },
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  let next = n;
  if (opts?.min != null) next = Math.max(opts.min, next);
  if (opts?.max != null) next = Math.min(opts.max, next);
  return next;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [dailyBankroll, setDailyBankroll] = useState(500);
  const [maxMarkets, setMaxMarkets] = useState(8);
  const [riskOfRuin, setRiskOfRuin] = useState(0.05);
  const [minAbsDelta, setMinAbsDelta] = useState(0.02);
  const [view, setView] = useState<ViewMode>("date");
  const [panel, setPanel] = useState<Panel>("markets");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  async function loadRemote() {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchLatestSnapshot();
      setSnapshot(next);
      setSelected(new Set());
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
        setSnapshot(data);
        setSelected(new Set());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid JSON");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  }

  const markets = useMemo(
    () => activeMarkets(snapshot?.predictions ?? []),
    [snapshot],
  );

  const selectedViews = useMemo(
    () => markets.filter((m) => selected.has(m.market_ticker)),
    [markets, selected],
  );

  const { trades, scale, estimatedRoR } = useMemo(
    () =>
      sizeSelectedTrades(selectedViews, {
        dailyBankroll,
        maxMarkets,
        riskOfRuin,
        minAbsDelta,
      }),
    [selectedViews, dailyBankroll, maxMarkets, riskOfRuin, minAbsDelta],
  );

  const totalStake = trades.reduce((sum, t) => sum + t.dollars, 0);
  const marketsByDelta = sortByTradeDelta(markets);
  const marketsByDate = groupMarketsByDate(markets);
  const tradesByDate = groupTradesByDate(trades);

  function toggleSelect(ticker: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }

  function toggleCollapsed(eventTicker: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(eventTicker)) next.delete(eventTicker);
      else next.add(eventTicker);
      return next;
    });
  }

  function selectAllVisible(rows: MarketView[]) {
    setSelected(new Set(rows.map((r) => r.market_ticker)));
  }

  function selectAllTomorrow() {
    const tomorrow = tomorrowUtcDateKey();
    const tickers = markets
      .filter(
        (m) =>
          m.eventDate === tomorrow &&
          m.side != null &&
          m.kellyFraction > 0 &&
          m.absTradeDelta >= minAbsDelta,
      )
      .map((m) => m.market_ticker);
    setSelected(new Set(tickers));
  }

  function clearSelected() {
    setSelected(new Set());
  }

  function showTradeAmounts() {
    setPanel("trades");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const tomorrowCount = useMemo(() => {
    const tomorrow = tomorrowUtcDateKey();
    return markets.filter(
      (m) =>
        m.eventDate === tomorrow &&
        m.side != null &&
        m.kellyFraction > 0 &&
        m.absTradeDelta >= minAbsDelta,
    ).length;
  }, [markets, minAbsDelta]);

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-6xl px-3 py-6 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-4 md:px-6 md:py-8 md:pt-10">
      <header className="mb-8 flex flex-col gap-4 border-b border-slate-200 pb-6 dark:border-slate-800 sm:mb-10 sm:pb-8 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium tracking-tight text-emerald-700 dark:text-emerald-400">
            Kalorie Desk
          </p>
          <h1 className="mt-1 max-w-xl text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl md:text-4xl">
            Pick markets, Kelly-size the book
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Past events are hidden. Check markets to include, then size with
            Kelly under a long-run risk-of-ruin cap.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          <button
            type="button"
            onClick={() => void loadRemote()}
            disabled={loading}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-medium text-white transition active:scale-[0.98] disabled:opacity-50 sm:flex-none dark:bg-emerald-600"
          >
            <ArrowClockwise size={16} weight="bold" />
            Refresh
          </button>
          <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 transition active:scale-[0.98] sm:flex-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
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

      <section className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Daily max ($)">
          <input
            type="number"
            min={0}
            step={10}
            defaultValue={dailyBankroll}
            onBlur={(e) =>
              setDailyBankroll(readNumber(e.target.value, dailyBankroll, { min: 0 }))
            }
            className={inputClass}
          />
        </Field>
        <Field label="Max markets / day">
          <input
            type="number"
            min={1}
            step={1}
            defaultValue={maxMarkets}
            onBlur={(e) =>
              setMaxMarkets(
                Math.floor(readNumber(e.target.value, maxMarkets, { min: 1 })),
              )
            }
            className={inputClass}
          />
        </Field>
        <Field label="Risk of ruin (long-run)">
          <input
            type="number"
            min={0.001}
            max={0.5}
            step={0.005}
            defaultValue={riskOfRuin}
            onBlur={(e) =>
              setRiskOfRuin(
                readNumber(e.target.value, riskOfRuin, { min: 0.001, max: 0.5 }),
              )
            }
            className={inputClass}
          />
        </Field>
        <Field label="Min |delta|">
          <input
            type="number"
            min={0}
            max={1}
            step={0.005}
            defaultValue={minAbsDelta}
            onBlur={(e) =>
              setMinAbsDelta(
                readNumber(e.target.value, minAbsDelta, { min: 0, max: 1 }),
              )
            }
            className={inputClass}
          />
        </Field>
      </section>

      {error ? (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          {error}
        </p>
      ) : null}

      {snapshot ? (
        <div className="mb-6 grid gap-1 text-sm text-slate-500 dark:text-slate-400 sm:flex sm:flex-wrap sm:items-baseline sm:gap-x-6">
          <span>
            Snapshot{" "}
            <span className="font-medium text-slate-800 dark:text-slate-200">
              {snapshot.snapshot_id}
            </span>
          </span>
          <span>
            {markets.length} open · {selected.size} selected
          </span>
          <span className="break-words">
            {trades.length} funded · {money(totalStake)} · Kelly{" "}
            {(scale * 100).toFixed(0)}% · RoR {pct(estimatedRoR)}
          </span>
        </div>
      ) : (
        <p className="mb-6 text-sm text-slate-500">
          {loading ? "Loading snapshot…" : "No snapshot loaded yet."}
        </p>
      )}

      <div className="mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={selectAllTomorrow}
          className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          Select all tomorrow
          {tomorrowCount ? ` (${tomorrowCount})` : ""}
        </button>
        <button
          type="button"
          onClick={() => selectAllVisible(markets)}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        >
          Select all open
        </button>
        <button
          type="button"
          onClick={clearSelected}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        >
          Clear selection
        </button>
      </div>

      <div className="mb-3 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-950">
        <TabButton active={panel === "markets"} onClick={() => setPanel("markets")}>
          Markets
        </TabButton>
        <TabButton active={panel === "trades"} onClick={() => setPanel("trades")}>
          Kelly book
        </TabButton>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-950">
        <TabButton
          active={view === "delta"}
          onClick={() => setView("delta")}
          icon={<ChartLineUp size={16} weight="bold" />}
        >
          <span className="sm:hidden">Delta</span>
          <span className="hidden sm:inline">Highest delta</span>
        </TabButton>
        <TabButton
          active={view === "date"}
          onClick={() => setView("date")}
          icon={<CalendarBlank size={16} weight="bold" />}
        >
          <span className="sm:hidden">Date</span>
          <span className="hidden sm:inline">By event date</span>
        </TabButton>
      </div>

      {panel === "markets" ? (
        view === "delta" ? (
          <EventGroups
            groups={groupMarketsByEvent(marketsByDelta)}
            collapsed={collapsed}
            selected={selected}
            onToggleCollapse={toggleCollapsed}
            onToggleSelect={toggleSelect}
          />
        ) : (
          <div className="space-y-8">
            {marketsByDate.map(([date, rows]) => (
              <div key={date}>
                <h2 className="mb-3 text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                  {date}
                  <span className="ml-2 font-normal text-slate-400">
                    {rows.length} markets
                  </span>
                </h2>
                <EventGroups
                  groups={groupMarketsByEvent(sortByTradeDelta(rows))}
                  collapsed={collapsed}
                  selected={selected}
                  onToggleCollapse={toggleCollapsed}
                  onToggleSelect={toggleSelect}
                />
              </div>
            ))}
            {!marketsByDate.length ? (
              <Empty text="No open (non-past) markets in this snapshot." />
            ) : null}
          </div>
        )
      ) : trades.length ? (
        view === "delta" ? (
          <TradesTable trades={[...trades].sort((a, b) => b.view.absTradeDelta - a.view.absTradeDelta)} />
        ) : (
          <div className="space-y-8">
            {tradesByDate.map(([date, rows]) => (
              <div key={date}>
                <h2 className="mb-3 text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-200">
                  {date}
                  <span className="ml-2 font-normal text-slate-400">
                    {rows.length} trades ·{" "}
                    {money(rows.reduce((s, t) => s + t.dollars, 0))}
                  </span>
                </h2>
                <TradesTable trades={rows} />
              </div>
            ))}
          </div>
        )
      ) : (
        <Empty text="Select markets with executable edge to build a Kelly book." />
      )}

      {selected.size > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 sm:px-4">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <p className="min-w-0 text-center text-xs text-slate-500 sm:text-left sm:text-sm dark:text-slate-400">
              {selected.size} selected · {trades.length} sized · {money(totalStake)}
            </p>
            <button
              type="button"
              onClick={showTradeAmounts}
              className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition active:scale-[0.98] sm:w-auto sm:py-2.5"
            >
              Show trade amounts
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base outline-none ring-emerald-500/40 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 sm:text-sm";

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function TabButton({
  active,
  onClick,
  children,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-emerald-600 text-white"
          : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-900"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700">
      {text}
    </p>
  );
}

function EventGroups({
  groups,
  collapsed,
  selected,
  onToggleCollapse,
  onToggleSelect,
}: {
  groups: [string, MarketView[]][];
  collapsed: Set<string>;
  selected: Set<string>;
  onToggleCollapse: (eventTicker: string) => void;
  onToggleSelect: (ticker: string) => void;
}) {
  if (!groups.length) return <Empty text="No markets to show." />;

  return (
    <div className="space-y-3">
      {groups.map(([eventTicker, rows]) => {
        const open = !collapsed.has(eventTicker);
        const title = rows[0]?.event_title || eventTicker;
        const date = rows[0]?.eventDate ?? "";
        return (
          <div
            key={eventTicker}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-950/60"
          >
            <button
              type="button"
              onClick={() => onToggleCollapse(eventTicker)}
              className="flex w-full items-center gap-2 px-3 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900/60"
            >
              {open ? <CaretDown size={16} /> : <CaretRight size={16} />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {title}
                </div>
                <div className="truncate font-mono text-[11px] text-slate-400">
                  {eventTicker} · {date} · {rows.length} markets
                </div>
              </div>
            </button>
            {open ? (
              <MarketsTable
                rows={rows}
                selected={selected}
                onToggleSelect={onToggleSelect}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function MarketsTable({
  rows,
  selected,
  onToggleSelect,
}: {
  rows: MarketView[];
  selected: Set<string>;
  onToggleSelect: (ticker: string) => void;
}) {
  return (
    <>
      <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-900 dark:border-slate-900 md:hidden">
        {rows.map((row) => {
          const canPick = Boolean(row.side && row.kellyFraction > 0);
          return (
            <li key={row.market_ticker} className="flex gap-3 px-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {row.target_phrase}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-slate-400">
                      {row.market_ticker}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {row.side ?? "-"}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-500">
                  <div>
                    Model{" "}
                    <span className="font-mono text-slate-800 dark:text-slate-200">
                      {pct(row.model_probability)}
                    </span>
                  </div>
                  <div>
                    B/A{" "}
                    <span className="font-mono text-slate-800 dark:text-slate-200">
                      {row.yes_bid.toFixed(2)}/{row.yes_ask.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    Delta{" "}
                    <span className="font-mono text-slate-800 dark:text-slate-200">
                      {row.tradeDelta === 0
                        ? "-"
                        : `${row.tradeDelta >= 0 ? "+" : ""}${row.tradeDelta.toFixed(3)}`}
                    </span>
                  </div>
                  <div>
                    Kelly{" "}
                    <span className="font-mono text-slate-800 dark:text-slate-200">
                      {row.kellyFraction > 0 ? pct(row.kellyFraction) : "-"}
                    </span>
                  </div>
                </dl>
              </div>
              <label className="flex shrink-0 items-center pl-1">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-emerald-600"
                  checked={selected.has(row.market_ticker)}
                  disabled={!canPick}
                  onChange={() => onToggleSelect(row.market_ticker)}
                  aria-label={`Select ${row.market_ticker}`}
                />
              </label>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-x-auto border-t border-slate-100 dark:border-slate-900 md:block">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
              <th className="px-3 py-2 font-medium">Phrase</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Bid / Ask</th>
              <th className="px-3 py-2 font-medium">Side</th>
              <th className="px-3 py-2 font-medium">Delta</th>
              <th className="px-3 py-2 font-medium">Kelly f*</th>
              <th className="px-3 py-2 text-right font-medium">Pick</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.market_ticker}
                className="border-b border-slate-100 last:border-0 dark:border-slate-900"
              >
                <td className="px-3 py-2.5 align-top">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {row.target_phrase}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                    {row.market_ticker}
                  </div>
                </td>
                <td className="px-3 py-2.5 align-top font-mono tabular-nums">
                  {pct(row.model_probability)}
                </td>
                <td className="px-3 py-2.5 align-top font-mono tabular-nums text-slate-500">
                  {row.yes_bid.toFixed(2)} / {row.yes_ask.toFixed(2)}
                </td>
                <td className="px-3 py-2.5 align-top text-xs font-semibold">
                  {row.side ?? "-"}
                </td>
                <td className="px-3 py-2.5 align-top font-mono tabular-nums">
                  {row.tradeDelta === 0
                    ? "-"
                    : `${row.tradeDelta >= 0 ? "+" : ""}${row.tradeDelta.toFixed(3)}`}
                </td>
                <td className="px-3 py-2.5 align-top font-mono tabular-nums text-slate-500">
                  {row.kellyFraction > 0 ? pct(row.kellyFraction) : "-"}
                </td>
                <td className="px-3 py-2.5 align-top text-right">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-emerald-600"
                    checked={selected.has(row.market_ticker)}
                    disabled={!row.side || row.kellyFraction <= 0}
                    onChange={() => onToggleSelect(row.market_ticker)}
                    aria-label={`Select ${row.market_ticker}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TradesTable({
  trades,
}: {
  trades: ReturnType<typeof sizeSelectedTrades>["trades"];
}) {
  return (
    <>
      <ul className="space-y-3 md:hidden">
        {trades.map((t) => (
          <li
            key={t.view.market_ticker}
            className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-950/60"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-slate-100">
                  {t.view.target_phrase}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-400">
                  {t.view.event_title || t.view.event_ticker}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${
                  t.side === "YES"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                    : "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                }`}
              >
                {t.side}
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
              <div>
                Delta{" "}
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  +{t.view.tradeDelta.toFixed(3)}
                </span>
              </div>
              <div>
                Kelly{" "}
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {pct(t.kellyFraction)}
                </span>
              </div>
              <div>
                Cost{" "}
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {t.cost.toFixed(2)}
                </span>
              </div>
              <div>
                Contracts{" "}
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  {t.contracts}
                </span>
              </div>
            </dl>
            <p className="mt-3 text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {money(t.dollars)}
            </p>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-950/60 md:block">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
              <th className="px-3 py-3 font-medium">Market</th>
              <th className="px-3 py-3 font-medium">Side</th>
              <th className="px-3 py-3 font-medium">Delta</th>
              <th className="px-3 py-3 font-medium">Kelly f</th>
              <th className="px-3 py-3 font-medium">Cost</th>
              <th className="px-3 py-3 font-medium">Contracts</th>
              <th className="px-3 py-3 font-medium">Stake</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr
                key={t.view.market_ticker}
                className="border-b border-slate-100 last:border-0 dark:border-slate-900"
              >
                <td className="px-3 py-3 align-top">
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {t.view.target_phrase}
                  </div>
                  <div className="mt-0.5 max-w-xs truncate text-xs text-slate-400">
                    {t.view.event_title || t.view.event_ticker}
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
                  +{t.view.tradeDelta.toFixed(3)}
                </td>
                <td className="px-3 py-3 align-top font-mono tabular-nums">
                  {pct(t.kellyFraction)}
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
    </>
  );
}
