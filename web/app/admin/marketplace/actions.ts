"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { pool } from "@/lib/db";
import { isCatalogKind, parseJsonText, validateCatalogData, validateCatalogId, validateSort } from "@/lib/catalog";

export type SaveState = { errors: string[] } | null;

function str(fd: FormData, key: string, max = 200_000): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

/** Create or update a marketplace item from the editor form. */
export async function saveCatalogItem(_prev: SaveState, fd: FormData): Promise<SaveState> {
  await requireAdmin();
  const mode = str(fd, "mode", 10) === "edit" ? "edit" : "create";
  const id = str(fd, "id", 100).trim();
  const kind = str(fd, "kind", 20);
  const published = str(fd, "published", 10) === "on";
  const sort = validateSort(str(fd, "sort", 20) || "0");
  const text = str(fd, "data");

  const errors: string[] = [];
  const idError = validateCatalogId(id);
  if (idError) errors.push(idError);
  if (!isCatalogKind(kind)) errors.push("Pick a kind: connector, skill or plugin.");
  if (sort === null) errors.push("Sort must be a whole number between -100000 and 100000.");
  const parsed = parseJsonText(text);
  if (!parsed.ok) errors.push(parsed.error);
  else if (isCatalogKind(kind)) errors.push(...validateCatalogData(kind, parsed.value));
  if (errors.length || !parsed.ok || !isCatalogKind(kind) || sort === null) return { errors };

  const data = JSON.stringify(parsed.value);
  try {
    if (mode === "create") {
      const res = await pool.query(
        `INSERT INTO catalog_items (id, kind, data, published, sort)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT (id) DO NOTHING RETURNING id`,
        [id, kind, data, published, sort],
      );
      if (!res.rowCount) return { errors: [`An item with the ID “${id}” already exists. Pick another ID or edit that one.`] };
    } else {
      const res = await pool.query(
        `UPDATE catalog_items SET kind = $2, data = $3::jsonb, published = $4, sort = $5, updated_at = now()
          WHERE id = $1`,
        [id, kind, data, published, sort],
      );
      if (!res.rowCount) return { errors: ["This item no longer exists. It may have been deleted."] };
    }
  } catch (err) {
    console.error("catalog save failed", err);
    return { errors: ["Could not save. Please try again."] };
  }
  revalidatePath("/admin/marketplace");
  redirect(`/admin/marketplace?saved=${encodeURIComponent(id)}`);
}

export async function setPublished(fd: FormData): Promise<void> {
  await requireAdmin();
  const id = str(fd, "id", 100);
  if (validateCatalogId(id)) return;
  const published = str(fd, "published", 10) === "true";
  await pool.query(`UPDATE catalog_items SET published = $2, updated_at = now() WHERE id = $1`, [id, published]);
  revalidatePath("/admin/marketplace");
}

export async function setSort(fd: FormData): Promise<void> {
  await requireAdmin();
  const id = str(fd, "id", 100);
  const sort = validateSort(str(fd, "sort", 20));
  if (validateCatalogId(id) || sort === null) return;
  await pool.query(`UPDATE catalog_items SET sort = $2, updated_at = now() WHERE id = $1`, [id, sort]);
  revalidatePath("/admin/marketplace");
}

export async function deleteCatalogItem(fd: FormData): Promise<void> {
  await requireAdmin();
  const id = str(fd, "id", 100);
  if (validateCatalogId(id)) return;
  await pool.query(`DELETE FROM catalog_items WHERE id = $1`, [id]);
  revalidatePath("/admin/marketplace");
}
