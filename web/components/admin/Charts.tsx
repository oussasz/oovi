// Tiny hand-written SVG charts for the admin console (no chart library).
// Colors come from CSS variables, so they follow light and dark mode.
// Each chart is an <svg role="img"> with a text summary, and every day has a
// hover tooltip (<title>).
import { fmtCompact, fmtDay, fmtInt } from "./format";

const W = 640;
const H = 220;
const PAD = { top: 14, right: 12, bottom: 28, left: 46 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;
const r1 = (v: number) => Math.round(v * 10) / 10;

type Format = (v: number) => string;

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = 10 ** exp;
  const f = raw / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * base;
}

/** Y scale with ~4 gridlines and a round top value. */
function scale(max: number, integer: boolean) {
  let step = niceStep(max / 4);
  if (integer) step = Math.max(1, Math.ceil(step));
  const top = Math.max(step * 4, step * Math.ceil(max / step));
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(v);
  return { top, ticks, y: (v: number) => r1(PAD.top + PLOT_H - (top ? (v / top) * PLOT_H : 0)) };
}

function xLabelIndexes(n: number): Set<number> {
  const stride = Math.max(1, Math.ceil(n / 6));
  const out = new Set<number>();
  for (let i = n - 1; i >= 0; i -= stride) out.add(i);
  return out;
}

function Frame({
  title,
  summary,
  labels,
  ticks,
  y,
  format,
  empty,
  children,
  legend,
}: {
  title: string;
  summary: string;
  labels: string[];
  ticks: number[];
  y: (v: number) => number;
  format: Format;
  empty: boolean;
  children: React.ReactNode;
  legend?: { name: string; color: string; total: number }[];
}) {
  const band = r1(PLOT_W / Math.max(1, labels.length));
  const shown = xLabelIndexes(labels.length);
  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${summary}`} className="chart-svg">
        <g className="chart-grid" aria-hidden>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {format(t)}
              </text>
            </g>
          ))}
        </g>
        <g className="chart-x" aria-hidden>
          {labels.map((l, i) =>
            shown.has(i) ? (
              <text key={l} x={r1(PAD.left + band * i + band / 2)} y={H - 8} textAnchor="middle">
                {fmtDay(l)}
              </text>
            ) : null,
          )}
        </g>
        {children}
        {empty && (
          <text x={PAD.left + PLOT_W / 2} y={PAD.top + PLOT_H / 2} textAnchor="middle" className="chart-empty">
            Nothing recorded in this period yet
          </text>
        )}
      </svg>
      {legend && (
        <ul className="chart-legend">
          {legend.map((s) => (
            <li key={s.name}>
              <span className="chart-swatch" style={{ background: s.color }} aria-hidden />
              {s.name} <b>{format === fmtCompact ? fmtInt(s.total) : format(s.total)}</b>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

function summarize(labels: string[], values: number[], format: Format): string {
  if (!labels.length) return "No data.";
  const total = values.reduce((a, b) => a + b, 0);
  let maxI = 0;
  values.forEach((v, i) => {
    if (v > values[maxI]!) maxI = i;
  });
  return `${fmtDay(labels[0]!)} to ${fmtDay(labels[labels.length - 1]!)}. Total ${format(total)}. Highest ${format(values[maxI] ?? 0)} on ${fmtDay(labels[maxI]!)}. Latest ${format(values[values.length - 1] ?? 0)}.`;
}

type SeriesProps = {
  title: string;
  labels: string[];
  values: number[];
  color?: string;
  /** Formats axis labels and tooltips. */
  format?: Format;
  integer?: boolean;
};

export function BarChart({ title, labels, values, color = "var(--blue-ink)", format = fmtCompact, integer = true }: SeriesProps) {
  const max = Math.max(0, ...values);
  const { ticks, y } = scale(max, integer);
  const band = r1(PLOT_W / Math.max(1, labels.length));
  const bw = r1(Math.max(1, band * 0.68));
  return (
    <Frame
      title={title}
      summary={summarize(labels, values, format)}
      labels={labels}
      ticks={ticks}
      y={y}
      format={format}
      empty={max === 0}
    >
      <g>
        {values.map((v, i) => {
          const x = r1(PAD.left + band * i);
          const top = y(v);
          return (
            <g key={labels[i]}>
              {v > 0 && (
                <rect x={r1(x + (band - bw) / 2)} y={top} width={bw} height={r1(y(0) - top)} rx={Math.min(3, bw / 3)} style={{ fill: color }} />
              )}
              <rect className="chart-hit" x={x} y={PAD.top} width={band} height={PLOT_H}>
                <title>{`${fmtDay(labels[i]!)}: ${format(v)}`}</title>
              </rect>
            </g>
          );
        })}
      </g>
    </Frame>
  );
}

export function LineChart({ title, labels, values, color = "var(--blue-ink)", format = fmtCompact, integer = true }: SeriesProps) {
  const max = Math.max(0, ...values);
  const { ticks, y } = scale(max, integer);
  const band = r1(PLOT_W / Math.max(1, labels.length));
  const pts = values.map((v, i) => [PAD.left + band * i + band / 2, y(v)] as const);
  const line = pts.map(([x, yy], i) => `${i ? "L" : "M"}${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  const area = pts.length
    ? `${line} L${pts[pts.length - 1]![0].toFixed(1)},${y(0)} L${pts[0]![0].toFixed(1)},${y(0)} Z`
    : "";
  const last = pts[pts.length - 1];
  return (
    <Frame
      title={title}
      summary={summarize(labels, values, format)}
      labels={labels}
      ticks={ticks}
      y={y}
      format={format}
      empty={max === 0}
    >
      {max > 0 && (
        <g>
          <path d={area} style={{ fill: color, opacity: 0.14 }} />
          <path d={line} className="chart-line" style={{ stroke: color }} />
          {last && <circle cx={last[0]} cy={last[1]} r={3.5} style={{ fill: color }} />}
        </g>
      )}
      <g>
        {values.map((v, i) => (
          <rect key={labels[i]} className="chart-hit" x={r1(PAD.left + band * i)} y={PAD.top} width={band} height={PLOT_H}>
            <title>{`${fmtDay(labels[i]!)}: ${format(v)}`}</title>
          </rect>
        ))}
      </g>
    </Frame>
  );
}

export type Series = { name: string; color: string; values: number[] };

export function StackedBarChart({
  title,
  labels,
  series,
  format = fmtCompact,
}: {
  title: string;
  labels: string[];
  series: Series[];
  format?: Format;
}) {
  const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = Math.max(0, ...totals);
  const { ticks, y } = scale(max, true);
  const band = r1(PLOT_W / Math.max(1, labels.length));
  const bw = r1(Math.max(1, band * 0.68));
  const legend = series.map((s) => ({ name: s.name, color: s.color, total: s.values.reduce((a, b) => a + b, 0) }));
  const summary = `${summarize(labels, totals, format)} ${legend.map((l) => `${l.name}: ${format(l.total)}`).join(", ")}.`;
  return (
    <Frame title={title} summary={summary} labels={labels} ticks={ticks} y={y} format={format} empty={max === 0} legend={legend}>
      <g>
        {labels.map((label, i) => {
          const x = r1(PAD.left + band * i + (band - bw) / 2);
          let acc = 0;
          return (
            <g key={label}>
              {series.map((s) => {
                const v = s.values[i] ?? 0;
                if (v <= 0) return null;
                const y1 = y(acc + v);
                const y0 = y(acc);
                acc += v;
                return <rect key={s.name} x={x} y={y1} width={bw} height={Math.max(0.5, r1(y0 - y1))} style={{ fill: s.color }} />;
              })}
              <rect className="chart-hit" x={r1(PAD.left + band * i)} y={PAD.top} width={band} height={PLOT_H}>
                <title>
                  {`${fmtDay(label)}: ${format(totals[i] ?? 0)} total` +
                    series.map((s) => `\n${s.name}: ${format(s.values[i] ?? 0)}`).join("")}
                </title>
              </rect>
            </g>
          );
        })}
      </g>
    </Frame>
  );
}

/** Horizontal bars for a split (e.g. versions in use). */
export function SplitBars({
  title,
  rows,
  format = fmtInt,
  color = "var(--blue-ink)",
  empty = "Nothing yet.",
}: {
  title: string;
  rows: { label: string; value: number }[];
  format?: Format;
  color?: string;
  empty?: string;
}) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      {rows.length === 0 || total === 0 ? (
        <p className="adm-empty">{empty}</p>
      ) : (
        <ul className="split">
          {rows.map((r) => (
            <li key={r.label}>
              <span className="split-label">{r.label}</span>
              <span className="split-track" aria-hidden>
                <span className="split-bar" style={{ width: `${max ? (r.value / max) * 100 : 0}%`, background: color }} />
              </span>
              <span className="split-value">
                {format(r.value)} <small>{Math.round((r.value / total) * 100)}%</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
