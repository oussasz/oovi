"use client";

// Safe tiny renderer for chat text: links, [text](url), **bold**, `code`,
// @mentions shown as coloured chips, [text](oovi://…) shown as small buttons
// that open a place in the app, and maths ($…$, $$…$$, \(…\), \[…\]) drawn by KaTeX.
// Never injects HTML from the text itself (KaTeX builds the maths markup, with links and HTML turned off).

import "katex/dist/katex.min.css";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FACE_COLORS } from "@/lib/faces";
import { ooviTarget, type OoviTarget } from "@/lib/oovi-links";
import type { Bot } from "@/lib/types";
import Icon from "./Icon";
import { openSettings } from "./SettingsModal";

// Maths first: $$…$$ and \[…\] (a block), \(…\) and $…$ (in a line). A $…$ needs no space inside its edges and
// no digit right after it, so prices ("$5 and $10") stay text.
const MATH = String.raw`\$\$[\s\S]{1,2000}?\$\$|\\\[[\s\S]{1,2000}?\\\]|\\\([^\n]{1,500}?\\\)|\$(?=[^\s$\d])[^$\n]{0,300}?[^\s$\\]\$(?!\d)|\$[A-Za-z]\$`;
const RE = /(\[[^\]\n]+\]\(oovi:\/\/[^\s)]+\)|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)\]>]+|\*\*[^*\n]+\*\*|`[^`\n]+`|@[\p{L}\p{N}_-]+)/gu;
const FULL = new RegExp(`(${MATH}|${RE.source.slice(1, -1)})`, "gu");
const IS_MATH = new RegExp(`^(?:${MATH})$`, "u");

type Katex = { renderToString: (tex: string, o: Record<string, unknown>) => string };
let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;

/** One formula: shown as typed until KaTeX is loaded (it loads once, on the first formula). */
function MathPart({ src }: { src: string }) {
  const block = src.startsWith("$$") || src.startsWith("\\[");
  const tex = block ? src.slice(2, -2) : src.startsWith("\\(") ? src.slice(2, -2) : src.slice(1, -1);
  const [k, setK] = useState<Katex | null>(katex);
  useEffect(() => {
    if (k) return;
    let alive = true;
    loading ??= import("katex").then((m) => (katex = (m.default ?? m) as unknown as Katex));
    void loading.then((x) => alive && setK(x)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [k]);
  if (!k) return <code>{src}</code>;
  const html = k.renderToString(tex, { displayMode: block, throwOnError: false, trust: false, strict: "ignore", maxSize: 20, maxExpand: 200, output: "htmlAndMathml" });
  return block ? <span className="math-block" dir="ltr" dangerouslySetInnerHTML={{ __html: html }} /> : <span className="math" dir="ltr" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** A button that only navigates inside the app (never runs anything, never opens a web page). */
function OoviLink({ label, target }: { label: string; target: OoviTarget }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="oovi-link"
      onClick={() => {
        if (target.kind === "settings") openSettings(target.tab);
        else router.push(target.href);
      }}
    >
      {label}
      <Icon name="arrow" size={12} />
    </button>
  );
}

/** bots: colour @mentions. linkBots: bots that oovi://bot/<name> links may open (defaults to bots). */
export default function Rich({ text, bots = [], linkBots }: { text: string; bots?: Bot[]; linkBots?: Bot[] }) {
  // Markdown headings ("## Title") read as bold lines instead of showing the # marks.
  const parts = text.replace(/^#{1,6}[ \t]+(.+?)[ \t]*#*$/gm, (_, h: string) => (h.includes("**") ? h : `**${h}**`)).split(FULL);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
        if (IS_MATH.test(p)) return <MathPart key={i} src={p} />;
        const app = p.match(/^\[([^\]\n]+)\]\((oovi:\/\/[^\s)]+)\)$/);
        if (app) {
          const target = ooviTarget(app[2] ?? "", linkBots ?? bots);
          return target ? <OoviLink key={i} label={app[1] ?? ""} target={target} /> : <span key={i}>{app[1]}</span>;
        }
        const md = p.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
        if (md) return <a key={i} href={md[2]} target="_blank" rel="noreferrer noopener">{md[1]}</a>;
        if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer noopener">{p.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}</a>;
        if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.length > 2 && p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
        if (p.startsWith("@")) {
          const handle = p.slice(1).toLowerCase();
          const bot = bots.find((b) => b.name.toLowerCase() === handle);
          if (bot) return <span key={i} className="mention" style={{ background: FACE_COLORS[bot.face.color] }}>@{bot.name}</span>;
          if (handle === "all" || handle === "everyone") return <span key={i} className="mention">{p}</span>;
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}
