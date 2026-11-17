"use client";

// A chart in the Canvas, drawn as SVG from a table's numbers (lib/canvas-core.ts chartData): column, bar,
// line, area, pie and doughnut. Colours come from the same palette as the charts in exported files.
// Hovering (or focusing) a mark shows its value; the legend names each series.
import { useState } from "react";

type Data = { categories: string[]; series: { name: string; values: (number | null)[] }[]; colors: string[] };
export type ChartType = "column" | "bar" | "line" | "area" | "pie" | "doughnut";

const W = 640;
const H = 340;
const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : String(Math.round(n * 100) / 100));
const short = (n: number) => {
  const a = Math.abs(n);
  return a >= 1e9 ? `${Math.round(n / 1e8) / 10}B` : a >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : a >= 1e4 ? `${Math.round(n / 100) / 10}k` : fmt(n);
};

/** Round axis steps: 0, 50, 100… that cover min..max. */
function ticks(min: number, max: number): number[] {
  if (min === max) max = min + 1;
  const span = max - min;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6);
  if (out.at(-1)! < max) out.push(out.at(-1)! + step);
  return out;
}

export function ChartView({ type, data, title }: { type: ChartType; data: Data; title?: string }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const cats = data.categories;
  const series = data.series;
  const color = (i: number) => data.colors[i % data.colors.length] ?? "#4F6BED";
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (!cats.length || !all.length) return <p className="cv-empty-chart">—</p>;
  const hover = (x: number, y: number, text: string) => ({ onMouseEnter: () => setTip({ x, y, text }), onMouseLeave: () => setTip(null), onFocus: () => setTip({ x, y, text }), onBlur: () => setTip(null), tabIndex: 0 });

  let body: React.ReactNode;
  if (type === "pie" || type === "doughnut") {
    const vals = (series[0]?.values ?? []).map((v) => Math.max(0, v ?? 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = 170;
    const cy = H / 2;
    const R = 130;
    let acc = -Math.PI / 2;
    const arcs = vals.map((v, i) => {
      const a0 = acc;
      const a1 = (acc += (v / total) * Math.PI * 2);
      const mid = (a0 + a1) / 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number, r: number) => `${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r}`;
      const d = v / total > 0.9999 ? `M ${cx - R} ${cy} A ${R} ${R} 0 1 1 ${cx + R} ${cy} A ${R} ${R} 0 1 1 ${cx - R} ${cy} Z` : `M ${cx} ${cy} L ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} Z`;
      return <path key={i} d={d} fill={color(i)} stroke="var(--panel)" strokeWidth={2} {...hover(cx + Math.cos(mid) * R * 0.6, cy + Math.sin(mid) * R * 0.6, `${cats[i]}: ${fmt(v)} (${Math.round((v / total) * 100)}%)`)} />;
    });
    body = (
      <>
        {arcs}
        {type === "doughnut" && <circle cx={cx} cy={cy} r={R * 0.55} fill="var(--panel)" />}
        {cats.slice(0, 12).map((c, i) => (
          <g key={i} transform={`translate(350 ${40 + i * 22})`}>
            <rect width={12} height={12} rx={3} fill={color(i)} />
            <text x={20} y={10.5} className="cv-ch-label">
              {c.length > 26 ? `${c.slice(0, 25)}…` : c} · {Math.round((vals[i]! / total) * 100)}%
            </text>
          </g>
        ))}
      </>
    );
  } else {
    const horizontal = type === "bar";
    const L = horizontal ? 130 : 52;
    const R = 16;
    const T = 14;
    const B = horizontal ? 28 : 54;
    const pw = W - L - R;
    const ph = H - T - B;
    const tk = ticks(Math.min(0, ...all), Math.max(0, ...all));
    const lo = tk[0]!;
    const hi = tk.at(-1)!;
    const n = cats.length;
    const scale = (v: number) => (v - lo) / (hi - lo);
    const band = (horizontal ? ph : pw) / n;
    const every = Math.max(1, Math.ceil(n / (horizontal ? 14 : 12)));
    const grid = tk.map((v) =>
      horizontal ? (
        <g key={v}>
          <line x1={L + scale(v) * pw} x2={L + scale(v) * pw} y1={T} y2={T + ph} className="cv-ch-grid" />
          <text x={L + scale(v) * pw} y={H - 8} textAnchor="middle" className="cv-ch-axis">
            {short(v)}
          </text>
        </g>
      ) : (
        <g key={v}>
          <line x1={L} x2={L + pw} y1={T + ph - scale(v) * ph} y2={T + ph - scale(v) * ph} className="cv-ch-grid" />
          <text x={L - 8} y={T + ph - scale(v) * ph + 4} textAnchor="end" className="cv-ch-axis">
            {short(v)}
          </text>
        </g>
      ),
    );
    const labels = cats.map((c, i) =>
      i % every ? null : horizontal ? (
        <text key={i} x={L - 8} y={T + band * (i + 0.5) + 4} textAnchor="end" className="cv-ch-axis">
          {c.length > 18 ? `${c.slice(0, 17)}…` : c}
        </text>
      ) : (
        <text key={i} x={L + band * (i + 0.5)} y={T + ph + 16} textAnchor="middle" className="cv-ch-axis">
          {c.length > 10 ? `${c.slice(0, 9)}…` : c}
        </text>
      ),
    );
    let marks: React.ReactNode;
    if (type === "line" || type === "area") {
      const px = (i: number) => L + band * (i + 0.5);
      const py = (v: number) => T + ph - scale(v) * ph;
      marks = series.map((s, si) => {
        const pts = s.values.map((v, i) => (v === null ? null : ([px(i), py(v)] as const)));
        const segs: string[] = [];
        let cur: string[] = [];
        for (const p of pts) {
          if (p) cur.push(`${p[0]},${p[1]}`);
          else if (cur.length) (segs.push(cur.join(" ")), (cur = []));
        }
        if (cur.length) segs.push(cur.join(" "));
        return (
          <g key={si}>
            {type === "area" && segs.map((sg, k) => <polygon key={k} points={`${sg.split(" ")[0]!.split(",")[0]},${py(Math.max(lo, 0))} ${sg} ${sg.split(" ").at(-1)!.split(",")[0]},${py(Math.max(lo, 0))}`} fill={color(si)} opacity={0.18} />)}
            {segs.map((sg, k) => (
              <polyline key={k} points={sg} fill="none" stroke={color(si)} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {n <= 60 && pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={3.5} fill={color(si)} stroke="var(--panel)" strokeWidth={1.5} {...hover(p[0], p[1], `${cats[i]} · ${s.name}: ${fmt(s.values[i]!)}`)} />)}
          </g>
        );
      });
    } else {
      const inner = band * 0.72;
      const bw = inner / series.length;
      marks = series.map((s, si) =>
        s.values.map((v, i) => {
          if (v === null) return null;
          const from = Math.min(scale(v), scale(0));
          const len = Math.abs(scale(v) - scale(0));
          const off = band * (i + 0.14) + bw * si;
          return horizontal ? (
            <rect key={`${si}-${i}`} x={L + from * pw} y={T + off} width={Math.max(1, len * pw)} height={Math.max(1, bw - 1)} rx={3} fill={color(si)} {...hover(L + scale(v) * pw, T + off, `${cats[i]} · ${s.name}: ${fmt(v)}`)} />
          ) : (
            <rect key={`${si}-${i}`} x={L + off} y={T + ph - (from + len) * ph} width={Math.max(1, bw - 1)} height={Math.max(1, len * ph)} rx={3} fill={color(si)} {...hover(L + off + bw / 2, T + ph - scale(v) * ph, `${cats[i]} · ${s.name}: ${fmt(v)}`)} />
          );
        }),
      );
    }
    body = (
      <>
        {grid}
        {labels}
        {marks}
        {!horizontal && series.length > 1 && (
          <g transform={`translate(${L} ${H - 14})`}>
            {series.map((s, i) => (
              <g key={i} transform={`translate(${i * 130} 0)`}>
                <rect width={12} height={12} rx={3} y={-10} fill={color(i)} />
                <text x={18} className="cv-ch-label">
                  {s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name}
                </text>
              </g>
            ))}
          </g>
        )}
      </>
    );
  }

  return (
    <figure className="cv-chart">
      {title && <figcaption>{title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title ?? "Chart"}>
        {body}
        {tip && (
          <g pointerEvents="none" transform={`translate(${Math.min(W - 8, Math.max(8, tip.x))} ${Math.max(22, tip.y - 10)})`}>
            <text textAnchor={tip.x > W * 0.7 ? "end" : tip.x < W * 0.3 ? "start" : "middle"} className="cv-ch-tip" paintOrder="stroke" stroke="var(--panel)" strokeWidth={5}>
              {tip.text}
            </text>
          </g>
        )}
      </svg>
    </figure>
  );
}
