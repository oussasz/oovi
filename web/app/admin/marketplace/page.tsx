import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { CATALOG_KINDS, isCatalogKind, type CatalogKind } from "@/lib/catalog";
import { listCatalog } from "@/lib/catalog-db";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { Empty, PageHead, Section } from "@/components/admin/ui";
import { fmtAgo } from "@/components/admin/format";
import { deleteCatalogItem, setPublished, setSort } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Marketplace" };

const KIND_LABELS: Record<CatalogKind, string> = { connector: "Connectors", skill: "Skills", plugin: "Plugins" };

export default async function AdminMarketplace({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; saved?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const kind = isCatalogKind(sp.kind) ? sp.kind : null;
  const items = await listCatalog(kind);
  const saved = typeof sp.saved === "string" ? sp.saved.slice(0, 64) : null;

  return (
    <>
      <PageHead
        title="Marketplace"
        sub="Connectors, skills and plugins the desktop app can show. Published items appear in the app within about 5 minutes."
      >
        <Link href={`/admin/marketplace/edit${kind ? `?kind=${kind}` : ""}`} className="btn btn-dark btn-sm">
          New item
        </Link>
      </PageHead>

      {saved && (
        <p className="alert alert-ok" role="status">
          Saved “{saved}”.
        </p>
      )}

      <Section
        title={kind ? KIND_LABELS[kind] : "All items"}
        actions={
          <nav className="adm-seg" aria-label="Filter by kind">
            <Link href="/admin/marketplace" className={kind === null ? "on" : undefined}>
              All
            </Link>
            {CATALOG_KINDS.map((k) => (
              <Link key={k} href={`/admin/marketplace?kind=${k}`} className={kind === k ? "on" : undefined}>
                {KIND_LABELS[k]}
              </Link>
            ))}
          </nav>
        }
      >
        {items.length === 0 ? (
          <Empty>
            {kind ? `No ${KIND_LABELS[kind].toLowerCase()} yet.` : "The marketplace is empty."}{" "}
            <Link href={`/admin/marketplace/edit${kind ? `?kind=${kind}` : ""}`} className="text-link">
              Add the first one
            </Link>
          </Empty>
        ) : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Name</th>
                  <th>ID</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const name = typeof (item.data as { name?: unknown }).name === "string" ? (item.data as { name: string }).name : item.id;
                  return (
                    <tr key={item.id}>
                      <td>
                        <form action={setSort} className="adm-inline-form">
                          <input type="hidden" name="id" value={item.id} />
                          <label className="sr-only" htmlFor={`sort-${item.id}`}>
                            Order for {name}
                          </label>
                          <input
                            id={`sort-${item.id}`}
                            className="input"
                            type="number"
                            name="sort"
                            defaultValue={item.sort}
                            step={1}
                            min={-100000}
                            max={100000}
                          />
                          <button type="submit" className="btn btn-ghost btn-sm">
                            Set
                          </button>
                        </form>
                      </td>
                      <td>
                        <Link href={`/admin/marketplace/edit?id=${encodeURIComponent(item.id)}`}>{name}</Link>
                      </td>
                      <td className="adm-mono">{item.id}</td>
                      <td>{item.kind}</td>
                      <td>
                        <form action={setPublished} className="adm-inline-form">
                          <input type="hidden" name="id" value={item.id} />
                          <input type="hidden" name="published" value={item.published ? "false" : "true"} />
                          <span className={`adm-badge${item.published ? " on" : ""}`}>{item.published ? "Published" : "Draft"}</span>
                          <button type="submit" className="btn btn-ghost btn-sm">
                            {item.published ? "Unpublish" : "Publish"}
                          </button>
                        </form>
                      </td>
                      <td className="nowrap">{fmtAgo(item.updatedAt)}</td>
                      <td>
                        <div className="adm-row-actions">
                          <Link href={`/admin/marketplace/edit?id=${encodeURIComponent(item.id)}`} className="btn btn-light btn-sm">
                            Edit
                          </Link>
                          <form action={deleteCatalogItem}>
                            <input type="hidden" name="id" value={item.id} />
                            <ConfirmButton
                              className="btn btn-ghost btn-sm"
                              message={`Delete “${name}” (${item.id})? This can't be undone, and it disappears from the app within about 5 minutes.`}
                            >
                              Delete
                            </ConfirmButton>
                          </form>
                        </div>
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
