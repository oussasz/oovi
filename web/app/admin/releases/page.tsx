import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { listReleases } from "@/lib/releases";
import { compareVersions, resolveNotes, versionOfTag } from "@/lib/release-notes";
import { SEED_NOTES } from "@/lib/release-notes-seed";
import { getNotesOverrides } from "@/lib/release-notes-db";
import { Empty, PageHead, Section } from "@/components/admin/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Release notes" };

const SOURCE: Record<string, string> = {
  edited: "Edited by you",
  default: "Default text",
  github: "From the release",
};

export default async function AdminReleases() {
  await requireAdmin();
  const [releases, overrides] = await Promise.all([listReleases(), getNotesOverrides()]);
  const byVersion = new Map(releases.map((r) => [versionOfTag(r.tag_name), r]));
  const versions = [...new Set([...byVersion.keys(), ...Object.keys(SEED_NOTES), ...Object.keys(overrides)])].sort(compareVersions);

  return (
    <>
      <PageHead
        title="Release notes"
        sub={
          <>
            What the public <Link href="/changelog" className="text-link">What’s new</Link> page says for each version. Every version has the same shape: a one-line headline, then New, Improved, Fixed and Good to know.
            Edit the words, or hide a version that doesn’t need to be there. A version appears on the website only once its release is published.
          </>
        }
      />
      <Section title="Versions">
        {versions.length === 0 ? (
          <Empty>No versions yet.</Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Headline</th>
                  <th>Points</th>
                  <th>On the website</th>
                  <th>Words from</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => {
                  const r = byVersion.get(v);
                  const res = resolveNotes(v, r?.body, overrides, SEED_NOTES);
                  const points = res.kind === "notes" ? res.notes.sections.reduce((n, s) => n + s.items.length, 0) : null;
                  const live = !!r;
                  return (
                    <tr key={v}>
                      <td className="adm-mono">{v}</td>
                      <td>{res.kind === "notes" ? res.notes.headline ?? <span className="adm-muted">none</span> : <span className="adm-muted">–</span>}</td>
                      <td>{points ?? "–"}</td>
                      <td>
                        {res.kind === "hidden" ? (
                          <span className="adm-badge">Hidden</span>
                        ) : !live ? (
                          <span className="adm-badge" title="This version has no published release, so the website doesn’t list it yet.">Not released</span>
                        ) : (
                          <span className="adm-badge on">Shown</span>
                        )}
                      </td>
                      <td>{res.kind === "hidden" ? (overrides[v] ? SOURCE.edited : SOURCE.default) : SOURCE[res.source]}</td>
                      <td>
                        <Link href={`/admin/releases/edit?v=${encodeURIComponent(v)}`} className="btn btn-light btn-sm">
                          Edit
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
