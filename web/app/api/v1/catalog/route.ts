import { NextResponse } from "next/server";
import { listHiddenCatalogIds, listPublishedCatalog } from "@/lib/catalog-db";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/catalog  (public)
 * Published marketplace items (connectors, skills, plugins) ordered by sort,
 * plus `hidden`: ids of unpublished items, which the app (0.7.0+) hides even
 * when it has a built-in copy. Cached at the edge for 5 minutes.
 */
export async function GET() {
  try {
    const [items, hidden] = await Promise.all([listPublishedCatalog(), listHiddenCatalogIds()]);
    return NextResponse.json(
      { items, hidden },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (err) {
    console.error("catalog load failed", err);
    return NextResponse.json(
      { error: "The catalog is not available right now." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
