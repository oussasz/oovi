// A page shared from oovi by a public link. Built from plain text or rows (lib/public-pages-core.ts): no
// script, no form, nothing from the page runs. Not indexed by search engines.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readPage } from "@/lib/public-pages";
import { ID_RE, pageHtml } from "@/lib/public-pages-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ id: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function SharedPage({ params }: Props) {
  const { id } = await params;
  if (!ID_RE.test(id)) notFound();
  const page = await readPage(id);
  if (!page) notFound();
  return (
    <main className="shared-page">
      <article>
        <header>
          <h1 dir="auto">{page.title}</h1>
          <p className="shared-meta">Updated {page.updatedAt.toISOString().slice(0, 10)}</p>
        </header>
        {/* Built and escaped by pageHtml: plain text and rows only. */}
        <div className={`shared-body ${page.content.kind}`} dangerouslySetInnerHTML={{ __html: pageHtml(page.content) }} />
      </article>
      <footer className="shared-foot">
        Shared from <Link href="/">oovi</Link>. Made by its user, not by the oovi team.
      </footer>
    </main>
  );
}
