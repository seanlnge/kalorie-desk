import { useEffect, useMemo, useRef } from "react";
import {
  binOutcomePoints,
  outcomeDistribution,
} from "../lib/outcomeDist";
import { money, pct } from "../lib/sizing";
import type { SizedTrade } from "../lib/types";

type Marker = {
  key: string;
  label: string;
  pnl: number;
  color: string;
  dash?: number[];
  width: number;
};

export function ExpectedPnlChart({ trades }: { trades: SizedTrade[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const summary = useMemo(() => outcomeDistribution(trades), [trades]);
  const bins = useMemo(
    () => binOutcomePoints(summary.points, 28),
    [summary.points],
  );

  const markers = useMemo<Marker[]>(
    () => [
      {
        key: "p10",
        label: "10%",
        pnl: summary.p10,
        color: "rgba(100, 116, 139, 0.95)",
        dash: [3, 3],
        width: 1,
      },
      {
        key: "p25",
        label: "25%",
        pnl: summary.p25,
        color: "rgba(14, 116, 144, 0.95)",
        dash: [5, 3],
        width: 1.25,
      },
      {
        key: "ev",
        label: "EV",
        pnl: summary.expectedPnl,
        color: "rgb(15, 23, 42)",
        width: 1.75,
      },
      {
        key: "p75",
        label: "75%",
        pnl: summary.p75,
        color: "rgba(5, 150, 105, 0.95)",
        dash: [5, 3],
        width: 1.25,
      },
      {
        key: "p90",
        label: "90%",
        pnl: summary.p90,
        color: "rgba(4, 120, 87, 0.95)",
        dash: [3, 3],
        width: 1,
      },
    ],
    [summary],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !bins.length) return;

    const draw = () => {
      const cssW = wrap.clientWidth;
      const cssH = 200;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const pad = { t: 36, r: 14, b: 28, l: 48 };
      const plotW = cssW - pad.l - pad.r;
      const plotH = cssH - pad.t - pad.b;
      const lo = summary.worstPnl;
      const hi = summary.bestPnl;
      const span = Math.max(hi - lo, 1e-6);
      const maxP = Math.max(...bins.map((b) => b.probability), 1e-9);

      const xOf = (pnl: number) => pad.l + ((pnl - lo) / span) * plotW;
      const yOf = (p: number) => pad.t + plotH - (p / maxP) * plotH;

      // Y-axis ticks with actual probability labels
      ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
      ctx.fillStyle = "rgb(100, 116, 139)";
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const yTicks = [0, maxP / 2, maxP];
      for (const p of yTicks) {
        const y = yOf(p);
        ctx.beginPath();
        ctx.moveTo(pad.l - 4, y);
        ctx.lineTo(pad.l + plotW, y);
        ctx.stroke();
        ctx.fillText(pct(p), pad.l - 8, y);
      }

      // Zero line
      if (lo < 0 && hi > 0) {
        const zx = xOf(0);
        ctx.strokeStyle = "rgba(100, 116, 139, 0.4)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(zx, pad.t);
        ctx.lineTo(zx, pad.t + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const barW = Math.max(2, (plotW / bins.length) * 0.82);
      for (const bin of bins) {
        const x = xOf(bin.pnl) - barW / 2;
        const y = yOf(bin.probability);
        const h = pad.t + plotH - y;
        ctx.fillStyle =
          bin.pnl >= 0
            ? "rgba(5, 150, 105, 0.55)"
            : "rgba(148, 163, 184, 0.55)";
        ctx.fillRect(x, y, barW, h);
      }

      // Percentile / EV vertical markers with labels
      ctx.textBaseline = "alphabetic";
      const labelRows = [14, 26];
      markers.forEach((m, i) => {
        const x = xOf(m.pnl);
        ctx.strokeStyle = m.color;
        ctx.lineWidth = m.width;
        ctx.setLineDash(m.dash ?? []);
        ctx.beginPath();
        ctx.moveTo(x, pad.t);
        ctx.lineTo(x, pad.t + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = m.color;
        ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
        const row = labelRows[i % labelRows.length];
        const text = `${m.label} ${money(m.pnl)}`;
        const tw = ctx.measureText(text).width;
        let tx = x;
        ctx.textAlign = "center";
        if (x - tw / 2 < pad.l) {
          ctx.textAlign = "left";
          tx = pad.l;
        } else if (x + tw / 2 > pad.l + plotW) {
          ctx.textAlign = "right";
          tx = pad.l + plotW;
        }
        ctx.fillText(text, tx, row);
      });

      ctx.fillStyle = "rgb(100, 116, 139)";
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(money(lo), pad.l, cssH - 8);
      ctx.textAlign = "right";
      ctx.fillText(money(hi), pad.l + plotW, cssH - 8);
      ctx.textAlign = "center";
      ctx.fillText("P&L ($)", pad.l + plotW / 2, cssH - 8);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [bins, markers, summary.bestPnl, summary.worstPnl]);

  if (!trades.length || !summary.points.length) return null;

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-800 dark:bg-slate-950/60 sm:p-4">
      <div className="mb-2 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Expected next-day result
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Model win probs × sized stakes (independent outcomes)
          </p>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          P(profit){" "}
          <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
            {pct(summary.probProfit)}
          </span>
          <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
          P(loss){" "}
          <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">
            {pct(summary.probLoss)}
          </span>
        </p>
      </div>
      <div ref={wrapRef} className="w-full">
        <canvas ref={canvasRef} className="block w-full" />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-5 dark:text-slate-400">
        {markers.map((m) => (
          <div key={m.key}>
            {m.label}{" "}
            <span className="font-medium tabular-nums text-slate-800 dark:text-slate-200">
              {money(m.pnl)}
            </span>
          </div>
        ))}
      </dl>
    </section>
  );
}
