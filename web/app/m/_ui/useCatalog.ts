"use client";

import { useEffect, useState } from "react";
import { getCatalog } from "../_lib/api";
import { catalogConnectors, type CatalogConnector } from "../_lib/connectors";

/**
 * The connectors people can add: the built-in list (the same file the website's console reads, loaded only when a
 * connector screen opens), with the published Marketplace copies over it. Offline, the built-in list alone.
 */
export function useCatalog(): { list: CatalogConnector[] | null; failed: boolean } {
  const [list, setList] = useState<CatalogConnector[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [builtin, logos] = await Promise.all([import("@/lib/builtin-catalog.json").then((m) => m.default as unknown[]), import("@/lib/builtin-logos.json").then((m) => m.default as Record<string, string>)]);
      let published: unknown[] = [];
      let hidden: string[] = [];
      try {
        const r = await getCatalog();
        published = Array.isArray(r?.items) ? r.items : [];
        hidden = Array.isArray(r?.hidden) ? r.hidden.filter((h): h is string => typeof h === "string") : [];
      } catch {
        if (alive) setFailed(true);
      }
      if (alive) setList(catalogConnectors(builtin as never[], published as never[], hidden, logos));
    })().catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);
  return { list, failed };
}
