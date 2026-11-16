"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { pool } from "@/lib/db";
import { isCatalogKind, parseJsonText, validateCatalogData, validateCatalogId, validateSort } from "@/lib/catalog";
import { BUILTIN_ITEMS, builtinById, type BuiltinItem } from "@/lib/builtin-catalog";
import { audit } from "@/lib/credits";
import { MAX_AVATAR_BYTES, isAvatarPng, saveAvatar } from "@/lib/avatars";

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

// ---------- the items built into the app ----------
// They live in the app's code (lib/catalog.ts). Copying one into the database makes it editable here like any
// other item: the copy wins over the app's version (same id) and reaches the app within about 10 minutes.

/** Copies one built-in item into the database. false when it was already there or isn't valid. */
async function copyBuiltin(it: BuiltinItem, published: boolean): Promise<boolean> {
  if (validateCatalogData(it.kind, it.data).length) return false;
  const res = await pool.query(
    `INSERT INTO catalog_items (id, kind, data, published, sort) VALUES ($1, $2, $3::jsonb, $4, $5) ON CONFLICT (id) DO NOTHING`,
    [it.id, it.kind, JSON.stringify(it.data), published, it.sort],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Make every built-in item that isn't in the database yet editable here. Never touches what is already there. */
export async function importAllBuiltin(): Promise<void> {
  const admin = await requireAdmin();
  let added = 0;
  for (const it of BUILTIN_ITEMS) if (await copyBuiltin(it, true)) added += 1;
  await audit(admin.email, "catalog.import", null, { added }).catch(() => {});
  revalidatePath("/admin/marketplace");
  redirect(`/admin/marketplace?imported=${added}`);
}

/** Edit a built-in item: copy it into the database (if it isn't there yet), then open it in the editor. */
export async function editBuiltin(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = str(fd, "id", 100);
  const it = validateCatalogId(id) ? null : builtinById(id);
  if (!it) redirect("/admin/marketplace");
  if (await copyBuiltin(it, true)) await audit(admin.email, "catalog.import", id, { added: 1 }).catch(() => {});
  revalidatePath("/admin/marketplace");
  redirect(`/admin/marketplace/edit?id=${encodeURIComponent(id)}`);
}

/** Hide a built-in item from the app: copy it as a draft (unpublished items are hidden even when the app has them built in). */
export async function hideBuiltin(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = str(fd, "id", 100);
  const it = validateCatalogId(id) ? null : builtinById(id);
  if (!it) return;
  await copyBuiltin(it, false);
  await audit(admin.email, "catalog.hide", id).catch(() => {});
  revalidatePath("/admin/marketplace");
}

/** Put a built-in item back to the app's own version (keeps its order and whether it is published). */
export async function restoreBuiltin(fd: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = str(fd, "id", 100);
  const it = validateCatalogId(id) ? null : builtinById(id);
  if (!it || validateCatalogData(it.kind, it.data).length) return;
  await pool.query(`UPDATE catalog_items SET kind = $2, data = $3::jsonb, updated_at = now() WHERE id = $1`, [id, it.kind, JSON.stringify(it.data)]);
  await audit(admin.email, "catalog.restore", id).catch(() => {});
  revalidatePath("/admin/marketplace");
}

/** A picture for a bot's face, from the editor (already resized there to 256 px): checked, stored, its id returned. */
export async function uploadAvatar(dataUrl: string): Promise<{ id?: string; error?: string }> {
  const admin = await requireAdmin();
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl ?? "").slice(0, MAX_AVATAR_BYTES * 2));
  const png = m ? Buffer.from(m[1]!, "base64") : null;
  if (!png || !isAvatarPng(png)) return { error: "That picture can't be used. Use a PNG, JPG or WebP image (it is made 256 px wide, under 300 KB)." };
  try {
    const id = await saveAvatar(png, admin.email);
    await audit(admin.email, "catalog.avatar", `avatar:${id}`, { bytes: png.length });
    return { id };
  } catch (err) {
    console.error("avatar upload failed", err instanceof Error ? err.message : err);
    return { error: "The picture could not be saved. Try again." };
  }
}
