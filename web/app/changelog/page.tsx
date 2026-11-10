import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { listReleases } from "@/lib/releases";

export const metadata: Metadata = {
  title: "What's new",
  description: "What changed in each version of oovi.",
};
export const revalidate = 300;

const version = (tag: string) => tag.replace(/^v/, "");
const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "";

/** **bold** and [text](link) inside a line; only links to this site stay links, everything is plain text. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<b key={`${key}-${i++}`}>{m[1]}</b>);
    else {
      const href = m[3]!;
      const ours = href.startsWith("/") || href.startsWith("https://oovi.conuron.com");
      out.push(ours ? <a key={`${key}-${i++}`} href={href}>{m[2]}</a> : m[2]);
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The small markdown the release notes use: headings, lists and paragraphs. */
function Notes({ body, id }: { body: string; id: string }) {
  const lines = body
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => !/github\.com|github/i.test(l)); // nothing points to the code host
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const k = () => `${id}-${blocks.length}`;
  const endPara = () => {
    if (para.length) blocks.push(<p key={k()}>{inline(para.join(" "), k())}</p>);
    para = [];
  };
  const endList = () => {
    if (list.length) {
      const key = k();
      blocks.push(<ul key={key}>{list.map((l, j) => <li key={j}>{inline(l, `${key}-${j}`)}</li>)}</ul>);
    }
    list = [];
  };
  for (const raw of lines) {
    const l = raw.trim();
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    const li = l.match(/^[-*•]\s+(.*)$/);
    if (!l || h) {
      endPara();
      endList();
      if (h && !/^what.s new in oovi/i.test(h[2]!)) blocks.push(<h3 key={k()}>{inline(h[2]!, k())}</h3>);
    } else if (li) {
      endPara();
      list.push(li[1]!);
    } else {
      endList();
      para.push(l);
    }
  }
  endPara();
  endList();
  return <>{blocks}</>;
}

export default async function ChangelogPage() {
  const releases = await listReleases();
  return (
    <>
      <SiteNav />
      <main className="container page page-narrow">
        <article className="legal changelog">
          <h1>What’s new in oovi</h1>
          <p className="meta">oovi updates itself. On Windows from the Microsoft Store, the Store keeps it up to date.</p>
          {releases.length === 0 && <p>The release notes can’t be shown right now. Please try again in a few minutes.</p>}
          {releases.map((r) => (
            <section key={r.tag_name} id={r.tag_name} style={{ scrollMarginTop: 96 }}>
              <h2>
                oovi {version(r.tag_name)} <span className="meta" style={{ fontSize: "0.6em", fontWeight: 500 }}>{when(r.published_at)}</span>
              </h2>
              <Notes body={r.body ?? ""} id={r.tag_name} />
            </section>
          ))}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
