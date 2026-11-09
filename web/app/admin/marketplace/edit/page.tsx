import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { CATALOG_TEMPLATES, isCatalogKind, validateCatalogId } from "@/lib/catalog";
import { getCatalogItem } from "@/lib/catalog-db";
import { CatalogEditor } from "@/components/admin/CatalogEditor";
import { PageHead } from "@/components/admin/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit item" };

export default async function AdminCatalogEdit({ searchParams }: { searchParams: Promise<{ id?: string; kind?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;

  if (typeof sp.id === "string") {
    if (validateCatalogId(sp.id)) notFound();
    const item = await getCatalogItem(sp.id);
    if (!item) notFound();
    return (
      <>
        <PageHead title={`Edit “${(item.data as { name?: string }).name ?? item.id}”`} sub={`ID ${item.id} · ${item.kind}`}>
          <Link href="/admin/marketplace" className="btn btn-ghost btn-sm">
            Back to marketplace
          </Link>
        </PageHead>
        <CatalogEditor
          mode="edit"
          initial={{
            id: item.id,
            kind: item.kind,
            published: item.published,
            sort: item.sort,
            dataText: JSON.stringify(item.data, null, 2),
          }}
        />
      </>
    );
  }

  const kind = isCatalogKind(sp.kind) ? sp.kind : "connector";
  return (
    <>
      <PageHead title="New marketplace item" sub="Fill in the details, paste or edit the JSON, and check the preview.">
        <Link href="/admin/marketplace" className="btn btn-ghost btn-sm">
          Back to marketplace
        </Link>
      </PageHead>
      <CatalogEditor
        mode="create"
        initial={{ id: "", kind, published: false, sort: 0, dataText: JSON.stringify(CATALOG_TEMPLATES[kind], null, 2) }}
      />
    </>
  );
}
