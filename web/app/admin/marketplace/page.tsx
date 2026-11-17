import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { CATALOG_KINDS, isCatalogKind, type CatalogKind } from "@/lib/catalog";
import { listCatalog } from "@/lib/catalog-db";
import { BUILTIN_ITEMS, builtinById, sameAsBuiltin } from "@/lib/builtin-catalog";
import { groupCatalog } from "@/lib/catalog-groups";
import { CatalogPicture } from "@/components/admin/CatalogPicture";
import { ConfirmButton } from "@/components/admin/ConfirmButton";
import { Empty, PageHead, Section } from "@/components/admin/ui";
import { fmtAgo } from "@/components/admin/format";
import { deleteCatalogItem, editBuiltin, hideBuiltin, importAllBuiltin, restoreBuiltin, setPublished, setSort } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Marketplace" };

const KIND_LABELS: Record<CatalogKind, string> = { connector: "Connectors", skill: "Skills", plugin: "Experts & teams" };
const nameOf = (data: unknown, id: string) => (typeof (data as { name?: unknown })?.name === "string" ? (data as { name: string }).name : id);

export default async function AdminMarketplace({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; saved?: string; imported?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const kind = isCatalogKind(sp.kind) ? sp.kind : null;
  const all = await listCatalog(null);
  const items = kind ? all.filter((i) => i.kind === kind) : all;
  const saved = typeof sp.saved === "string" ? sp.saved.slice(0, 64) : null;
  const imported = sp.imported !== undefined && /^\d{1,4}$/.test(sp.imported) ? Number(sp.imported) : null;

  // Built into the app but not in the database yet: shown here too, so nothing is hidden from you.
  const inDb = new Set(all.map((i) => i.id));
  const missing = BUILTIN_ITEMS.filter((b) => !inDb.has(b.id));
  const onlyInApp = kind ? missing.filter((b) => b.kind === kind) : missing;
  // One list, on the same shelves as in the app: experts, teams, connectors by category, skills by category.
  const groups = groupCatalog([
    ...items.map((item) => ({ id: item.id, kind: item.kind, sort: item.sort, data: item.data as unknown as Record<string, unknown>, item })),
    ...onlyInApp.map((b) => ({ id: b.id, kind: b.kind, sort: b.sort, data: b.data as Record<string, unknown>, builtin: b })),
  ]);

  return (
    <>
      <PageHead
        title="Marketplace"
        sub="Everything the desktop app’s Marketplace shows. Items in the database are edited here and reach the app (0.7.0 and later) within about 10 minutes: unpublish to hide one, edit to change it, or add new ones. Items marked “Only in the app” are still built into the app’s code: one click makes them editable here, and they stay exactly as they are until you change them."
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
      {imported !== null && (
        <p className="alert alert-ok" role="status">
          {imported ? `${imported} built-in item${imported === 1 ? " is" : "s are"} now editable here.` : "Everything built into the app was already here."}
        </p>
      )}

      {missing.length > 0 && (
        <section className="card adm-card" aria-labelledby="mk-import">
          <div className="adm-card-head">
            <div>
              <h2 id="mk-import">{missing.length} items can’t be edited here yet</h2>
              <p className="adm-sub">
                They are written into the app’s code ({BUILTIN_ITEMS.length - missing.length} of {BUILTIN_ITEMS.length} are in the database). Make them editable
                and every one becomes a normal row you can change, hide or delete. Nothing changes for people until you edit something.
              </p>
            </div>
            <form action={importAllBuiltin}>
              <ConfirmButton className="btn btn-dark btn-sm" message={`Make all ${missing.length} built-in items editable here? Their content stays exactly as it is in the app. Items you already have are never touched.`}>
                Make all editable
              </ConfirmButton>
            </form>
          </div>
        </section>
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
        {items.length === 0 && onlyInApp.length === 0 ? (
          <Empty>
            {kind ? `No ${KIND_LABELS[kind].toLowerCase()} yet.` : "The marketplace is empty."}{" "}
            <Link href={`/admin/marketplace/edit${kind ? `?kind=${kind}` : ""}`} className="text-link">
              Add the first one
            </Link>
          </Empty>
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.key} className="adm-group" aria-labelledby={`g-${g.key}`}>
                <h3 id={`g-${g.key}`}>
                  {g.title} <span className="adm-count">{g.rows.length}</span>
                </h3>
                <div className="adm-table-wrap">
                  <table className="adm-table adm-table-items">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Item</th>
                        <th>ID</th>
                        <th>Status</th>
                        <th>Source</th>
                        <th>Updated</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((row) => {
                        const d = row.data.description;
                        const desc = typeof d === "string" ? (d.length > 90 ? `${d.slice(0, 90)}…` : d) : "";
                        if ("item" in row) {
                          const item = row.item;
                  const name = nameOf(item.data, item.id);
                  const builtin = builtinById(item.id);
                  const same = builtin ? sameAsBuiltin(item) : false;
                  return (
                    <tr key={item.id}>
                      <td>
                        <form action={setSort} className="adm-inline-form">
                          <input type="hidden" name="id" value={item.id} />
                          <label className="sr-only" htmlFor={`sort-${item.id}`}>
                            Order for {name}
                          </label>
                          <input id={`sort-${item.id}`} className="input" type="number" name="sort" defaultValue={item.sort} step={1} min={-100000} max={100000} />
                          <button type="submit" className="btn btn-ghost btn-sm">
                            Set
                          </button>
                        </form>
                      </td>
                      <td>
                        <Link href={`/admin/marketplace/edit?id=${encodeURIComponent(item.id)}`} className="adm-item">
                          <CatalogPicture id={item.id} kind={item.kind} data={row.data} />
                          <span>
                            <b>{name}</b>
                            {desc && <small>{desc}</small>}
                          </span>
                        </Link>
                      </td>
                      <td className="adm-mono">{item.id}</td>
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
                      <td>
                        {!builtin ? (
                          <span className="adm-badge">Added by you</span>
                        ) : same ? (
                          <span className="adm-badge" title="The same as the version built into the app">
                            Same as the app
                          </span>
                        ) : (
                          <span className="adm-badge on" title="This version replaces the one built into the app: you changed it, or the app has a newer version since you copied it">
                            Differs from the app
                          </span>
                        )}
                      </td>
                      <td className="nowrap">{fmtAgo(item.updatedAt)}</td>
                      <td>
                        <div className="adm-row-actions">
                          <Link href={`/admin/marketplace/edit?id=${encodeURIComponent(item.id)}`} className="btn btn-light btn-sm">
                            Edit
                          </Link>
                          {builtin && !same && (
                            <form action={restoreBuiltin}>
                              <input type="hidden" name="id" value={item.id} />
                              <ConfirmButton className="btn btn-ghost btn-sm" message={`Replace “${name}” with the version built into the app? Your changes to it are lost (they can't be recovered).`}>
                                Use the app’s version
                              </ConfirmButton>
                            </form>
                          )}
                          <form action={deleteCatalogItem}>
                            <input type="hidden" name="id" value={item.id} />
                            <ConfirmButton
                              className="btn btn-ghost btn-sm"
                              message={
                                builtin
                                  ? `Delete this copy of “${name}” (${item.id})? The app goes back to its own built-in version, and that disappears from the app within about 10 minutes.`
                                  : `Delete “${name}” (${item.id})? This can't be undone, and it disappears from the app within about 10 minutes.`
                              }
                            >
                              Delete
                            </ConfirmButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  );
                        }
                        const b = row.builtin;
                  const name = nameOf(b.data, b.id);
                  return (
                    <tr key={`app-${b.id}`}>
                      <td className="adm-mono" title="The app's own order">
                        {b.sort}
                      </td>
                      <td>
                        <span className="adm-item">
                          <CatalogPicture id={b.id} kind={b.kind} data={row.data} />
                          <span>
                            <b>{name}</b>
                            {desc && <small>{desc}</small>}
                          </span>
                        </span>
                      </td>
                      <td className="adm-mono">{b.id}</td>
                      <td>
                        <span className="adm-badge on">Shown in the app</span>
                      </td>
                      <td>
                        <span className="adm-badge" title="Written into the app's code. Make it editable to change it here.">
                          Only in the app
                        </span>
                      </td>
                      <td className="nowrap">–</td>
                      <td>
                        <div className="adm-row-actions">
                          <form action={editBuiltin}>
                            <input type="hidden" name="id" value={b.id} />
                            <button type="submit" className="btn btn-light btn-sm">
                              Edit
                            </button>
                          </form>
                          <form action={hideBuiltin}>
                            <input type="hidden" name="id" value={b.id} />
                            <ConfirmButton className="btn btn-ghost btn-sm" message={`Hide “${name}” from the app? It disappears within about 10 minutes, and you can publish it again here later.`}>
                              Hide
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
              </section>
            ))}
          </>
        )}
      </Section>
    </>
  );
}
