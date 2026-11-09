import { pool } from "./db";
import type { CatalogData, CatalogItem, CatalogKind } from "./catalog";

type Row = {
  id: string;
  kind: CatalogKind;
  data: CatalogData;
  published: boolean;
  sort: number;
  created_at: Date;
  updated_at: Date;
};

function toItem(r: Row): CatalogItem {
  return {
    id: r.id,
    kind: r.kind,
    data: r.data,
    published: r.published,
    sort: r.sort,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

export type PublicCatalogItem = { id: string; kind: CatalogKind; data: CatalogData; updatedAt: string };

export async function listPublishedCatalog(): Promise<PublicCatalogItem[]> {
  const { rows } = await pool.query<Row>(
    `SELECT id, kind, data, updated_at FROM catalog_items WHERE published ORDER BY sort ASC, id ASC`,
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, data: r.data, updatedAt: new Date(r.updated_at).toISOString() }));
}

/** Ids of unpublished items: the app hides its built-in copy of these. */
export async function listHiddenCatalogIds(): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(`SELECT id FROM catalog_items WHERE NOT published ORDER BY id`);
  return rows.map((r) => r.id);
}

export async function listCatalog(kind: CatalogKind | null): Promise<CatalogItem[]> {
  const { rows } = await pool.query<Row>(
    `SELECT id, kind, data, published, sort, created_at, updated_at
       FROM catalog_items
      WHERE ($1::text IS NULL OR kind = $1)
      ORDER BY sort ASC, id ASC`,
    [kind],
  );
  return rows.map(toItem);
}

export async function getCatalogItem(id: string): Promise<CatalogItem | null> {
  const { rows } = await pool.query<Row>(
    `SELECT id, kind, data, published, sort, created_at, updated_at FROM catalog_items WHERE id = $1`,
    [id],
  );
  return rows[0] ? toItem(rows[0]) : null;
}
