// The Marketplace items built into the desktop app, as a file the admin console can read (generated from the
// app's lib/catalog.ts by scripts/sync-web-catalog.mts; a unit test keeps it current). The console shows them next
// to the database items and can copy any of them into the database, where they are edited like the rest.
import raw from "./builtin-catalog.json";
import type { CatalogData, CatalogKind } from "./catalog";

export type BuiltinItem = { id: string; kind: CatalogKind; sort: number; data: CatalogData };

export const BUILTIN_ITEMS = raw as unknown as BuiltinItem[];

export const builtinById = (id: string): BuiltinItem | null => BUILTIN_ITEMS.find((i) => i.id === id) ?? null;

/** JSON with the keys in a fixed order, so two copies of the same data compare equal whatever order they were saved in. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export const sameAsBuiltin = (item: { id: string; data: unknown }): boolean => {
  const b = builtinById(item.id);
  return !!b && stableJson(b.data) === stableJson(item.data);
};
