import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { listReleases } from "@/lib/releases";
import { SECTION_TITLES, isVersion, resolveNotes, versionOfTag, type SectionTitle } from "@/lib/release-notes";
import { SEED_NOTES } from "@/lib/release-notes-seed";
import { getNotesOverrides } from "@/lib/release-notes-db";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { ReleaseNotesEditor } from "@/components/admin/ReleaseNotesEditor";
import { PageHead } from "@/components/admin/ui";
import { resetReleaseNotes } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit release notes" };

export default async function AdminReleaseEdit({ searchParams }: { searchParams: Promise<{ v?: string; done?: string }> }) {
  await requireAdmin();
  const { v, done } = await searchParams;
  if (!isVersion(v)) notFound();
  const [releases, overrides] = await Promise.all([listReleases(), getNotesOverrides()]);
  const release = releases.find((r) => versionOfTag(r.tag_name) === v);
  if (!release && !SEED_NOTES[v] && !overrides[v]) notFound();

  const res = resolveNotes(v, release?.body, overrides, SEED_NOTES);
  // A hidden version keeps its words in the form, so showing it again doesn't mean retyping.
  const stored = overrides[v] ?? SEED_NOTES[v] ?? (res.kind === "notes" ? res.notes : null);
  const hidden = res.kind === "hidden";
  const textOf = (t: SectionTitle) => stored?.sections.find((s) => s.title === t)?.items.join("\n") ?? "";
  const original = res.kind === "legacy" ? res.markdown : "";
  const edited = !!overrides[v];

  return (
    <>
      <PageHead title={`Release notes · ${v}`} sub={release ? "Published release." : "No published release for this version yet: it shows on the website once it is published."}>
        <Link href="/admin/releases" className="btn btn-ghost btn-sm">
          Back to versions
        </Link>
        <Link href={`/changelog#v${v}`} className="btn btn-ghost btn-sm" target="_blank">
          See it on the website
        </Link>
      </PageHead>

      {(done === "saved" || done === "hidden" || done === "reset") && (
        <p className="alert alert-ok" role="status">
          {done === "saved" ? "Saved. It shows on the website within a minute." : done === "hidden" ? "Saved. This version is hidden on the website." : "Back to the default text."}
        </p>
      )}

      {original && (
        <details className="adm-advanced" open>
          <summary>The notes as written on the release (copy what is useful)</summary>
          <pre className="adm-pre">{original}</pre>
        </details>
      )}

      <section className="card adm-card">
        <ReleaseNotesEditor
          key={`${v}-${done ?? ""}-${edited}`}
          version={v}
          initial={{ headline: stored?.headline ?? "", texts: Object.fromEntries(SECTION_TITLES.map((t) => [t, textOf(t)])) as Record<SectionTitle, string>, hidden }}
        />
      </section>

      {edited && (
        <section className="card adm-card">
          <h2>Back to the default</h2>
          <p className="adm-sub">Removes your changes to {v}. The text goes back to the default one shipped with the site{SEED_NOTES[v] ? "" : ", or to the release’s own notes"}.</p>
          <form action={resetReleaseNotes}>
            <input type="hidden" name="version" value={v} />
            <ConfirmButton className="btn btn-ghost btn-sm" message={`Remove your changes to ${v}? They can't be recovered.`}>
              Use the default text
            </ConfirmButton>
          </form>
        </section>
      )}
    </>
  );
}
