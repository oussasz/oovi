// Safe tiny renderer for chat text: links, [text](url), **bold**, `code`,
// and @mentions shown as coloured chips. Never injects HTML.

import { FACE_COLORS } from "@/lib/faces";
import type { Bot } from "@/lib/types";

const RE = /(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)\]>]+|\*\*[^*\n]+\*\*|`[^`\n]+`|@[\p{L}\p{N}_-]+)/gu;

export default function Rich({ text, bots = [] }: { text: string; bots?: Bot[] }) {
  const parts = text.split(RE);
  return (
    <>
      {parts.map((p, i) => {
        if (!p) return null;
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
