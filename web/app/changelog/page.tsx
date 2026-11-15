import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { listReleases } from "@/lib/releases";
import { resolveNotes, versionOfTag, type Notes as ReleaseNotes } from "@/lib/release-notes";
import { SEED_NOTES } from "@/lib/release-notes-seed";
import { getNotesOverrides } from "@/lib/release-notes-db";

export const metadata: Metadata = {
  title: "What's new",
  description: "What changed in each version of oovi.",
};
export const revalidate = 300;

const version = versionOfTag;
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

/** One version in the standard shape: headline, then New / Improved / Fixed / Good to know. */
function Standard({ notes, id }: { notes: ReleaseNotes; id: string }) {
  return (
    <>
      {notes.headline && <p className="rn-headline">{notes.headline}</p>}
      {notes.sections.map((sec) => (
        <div key={sec.title} className={`rn-section rn-${sec.title.toLowerCase().replace(/\s+/g, "-")}`}>
          <h3>{sec.title}</h3>
          <ul>
            {sec.items.map((it, j) => (
              <li key={j}>{inline(it, `${id}-${sec.title}-${j}`)}</li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

export default async function ChangelogPage() {
  const [releases, overrides] = await Promise.all([listReleases(), getNotesOverrides()]);
  const shown = releases
    .map((r) => ({ r, res: resolveNotes(version(r.tag_name), r.body, overrides, SEED_NOTES) }))
    .filter((x) => x.res.kind !== "hidden");
  return (
    <>
      <SiteNav />
      <main className="container page page-narrow">
        <article className="legal changelog">
          <h1>What’s new in oovi</h1>
          <p className="meta">Every version, newest first.</p>
          <aside className="summary rn-update" aria-label="Installing and updating">
            <b>Updating oovi</b>
            <ul>
              <li>oovi updates itself: click “Restart now” when it asks. Everything you set up is kept.</li>
              <li>From the Microsoft Store, the Store updates it for you.</li>
              <li>On Linux, download the new file from the <a href="/download">download page</a>.</li>
              <li>On a Mac, the first time: open oovi, click Done, then System Settings › Privacy &amp; Security › Open Anyway.</li>
            </ul>
          </aside>
          {shown.length === 0 && <p>The release notes can’t be shown right now. Please try again in a few minutes.</p>}
          {shown.map(({ r, res }, i) => (
            <section key={r.tag_name} id={r.tag_name} style={{ scrollMarginTop: 96 }}>
              <h2>
                oovi {version(r.tag_name)}{" "}
                {i === 0 && <span className="rn-latest">Latest</span>}
                <span className="meta rn-date">{when(r.published_at)}</span>
              </h2>
              {res.kind === "notes" && <Standard notes={res.notes} id={r.tag_name} />}
              {res.kind === "legacy" && <Notes body={res.markdown} id={r.tag_name} />}
            </section>
          ))}
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
