"use client";

// A Canvas page shown as a document: headings, lists with tick-boxes (a click ticks the step), tables,
// quotes and code, from the page's Markdown (lib/page-blocks.ts). Text inside goes through Rich, so links
// and bold work and no HTML is ever injected.
import { parseBlocks, progress } from "@/lib/page-blocks";
import Rich from "./Rich";

export function PageView({ text, onToggle }: { text: string; onToggle?: (line: number) => void }) {
  const blocks = parseBlocks(text);
  const p = progress(text);
  return (
    <div className="cv-read" dir="auto">
      {p && (
        <div className="cv-progress" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done} aria-label={`${p.done} / ${p.total}`}>
          <span style={{ width: `${Math.round((p.done / p.total) * 100)}%` }} />
          <b>
            {p.done} / {p.total}
          </b>
        </div>
      )}
      {blocks.map((b, i) => {
        if (b.kind === "h") {
          const H = (["h1", "h2", "h3"] as const)[b.level - 1]!;
          return (
            <H key={i} dir="auto">
              <Rich text={b.text} />
            </H>
          );
        }
        if (b.kind === "p")
          return (
            <p key={i} dir="auto">
              <Rich text={b.text} />
            </p>
          );
        if (b.kind === "hr") return <hr key={i} />;
        if (b.kind === "quote")
          return (
            <blockquote key={i} dir="auto">
              <Rich text={b.text} />
            </blockquote>
          );
        if (b.kind === "code") return <pre key={i}>{b.text}</pre>;
        if (b.kind === "table")
          return (
            <div key={i} className="cv-read-table">
              <table>
                <thead>
                  <tr>
                    {b.head.map((c, j) => (
                      <th key={j} dir="auto">
                        <Rich text={c} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, k) => (
                    <tr key={k}>
                      {b.head.map((_, j) => (
                        <td key={j} dir="auto">
                          <Rich text={r[j] ?? ""} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        const L = b.ordered ? "ol" : "ul";
        return (
          <L key={i} className={b.items.some((it) => it.done !== null) ? "cv-steps" : undefined}>
            {b.items.map((it) => (
              <li key={it.line} dir="auto" style={it.depth ? { marginInlineStart: it.depth * 22 } : undefined} className={it.done ? "done" : undefined}>
                {it.done !== null ? (
                  <label>
                    <input type="checkbox" checked={it.done} disabled={!onToggle} onChange={() => onToggle?.(it.line)} />
                    <span>
                      <Rich text={it.text} />
                    </span>
                  </label>
                ) : (
                  <Rich text={it.text} />
                )}
              </li>
            ))}
          </L>
        );
      })}
    </div>
  );
}
