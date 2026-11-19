"use client";

// Draws a bot reply from the Markdown tree (../_lib/markdown.ts) with React: text stays text, links open in a
// new tab with no access back to oovi, wide tables scroll inside the bubble (never the page).
import { Fragment, useMemo, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "../_lib/markdown";

function inl(nodes: Inline[], key = ""): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}${i}`;
    switch (n.t) {
      case "text":
        return <Fragment key={k}>{n.v}</Fragment>;
      case "br":
        return <br key={k} />;
      case "b":
        return <strong key={k}>{inl(n.c, k)}</strong>;
      case "i":
        return <em key={k}>{inl(n.c, k)}</em>;
      case "s":
        return <del key={k}>{inl(n.c, k)}</del>;
      case "code":
        return (
          <code key={k} dir="ltr">
            {n.v}
          </code>
        );
      case "a":
        return (
          <a key={k} href={n.href} target="_blank" rel="noopener noreferrer nofollow">
            {inl(n.c, k)}
          </a>
        );
    }
  });
}

function block(b: Block, i: number): ReactNode {
  switch (b.t) {
    case "p":
      return (
        <p key={i} dir="auto">
          {inl(b.c)}
        </p>
      );
    case "h": {
      const H = (`h${Math.min(6, b.level + 2)}` as "h3");
      return (
        <H key={i} dir="auto">
          {inl(b.c)}
        </H>
      );
    }
    case "ul":
      return (
        <ul key={i} dir="auto">
          {b.items.map((it, k) => (
            <li key={k}>{inl(it)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={i} start={b.start} dir="auto">
          {b.items.map((it, k) => (
            <li key={k}>{inl(it)}</li>
          ))}
        </ol>
      );
    case "quote":
      return <blockquote key={i}>{b.c.map(block)}</blockquote>;
    case "code":
      return (
        <pre key={i} dir="ltr" tabIndex={0}>
          <code>{b.v}</code>
        </pre>
      );
    case "hr":
      return <hr key={i} />;
    case "table":
      return (
        <div key={i} className="m-md__table" tabIndex={0} role="region" aria-label="table">
          <table>
            <thead>
              <tr>
                {b.head.map((h, k) => (
                  <th key={k} style={{ textAlign: b.align[k] === "r" ? "end" : b.align[k] === "c" ? "center" : "start" }} dir="auto">
                    {inl(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, k) => (
                    <td key={k} style={{ textAlign: b.align[k] === "r" ? "end" : b.align[k] === "c" ? "center" : "start" }} dir="auto">
                      {inl(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="m-md">{blocks.map(block)}</div>;
}
