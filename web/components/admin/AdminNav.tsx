"use client";

// The admin menu: sections on the left (with what's waiting, as a number), and the section's pages as
// tabs above the content (components/admin/nav-config.ts).
import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { locate, SECTIONS, type BadgeKey, type NavSection } from "./nav-config";

const total = (s: NavSection, badges: Partial<Record<BadgeKey, number>>) => s.pages.reduce((n, p) => n + (p.badge ? (badges[p.badge] ?? 0) : 0), 0);

function Count({ n, label }: { n: number; label: string }) {
  if (!n) return null;
  return (
    <span className="adm-count" aria-label={label}>
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function AdminNav({ badges, path }: { badges: Partial<Record<BadgeKey, number>>; path?: string }) {
  const current = usePathname();
  const here = locate(path ?? current);
  const nav = useRef<HTMLElement>(null);
  // On a phone the sections are one scrolling row: keep the current one in view.
  useEffect(() => {
    nav.current?.querySelector<HTMLElement>("a.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [here?.section.key]);
  return (
    <nav className="adm-nav" aria-label="Admin sections" ref={nav}>
      <ul>
        {SECTIONS.map((s) => {
          const on = here?.section.key === s.key;
          const n = total(s, badges);
          return (
            <li key={s.key}>
              <Link href={s.pages[0]!.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
                <span>{s.label}</span>
                <Count n={n} label={`${n} waiting`} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The current section's pages, when it has more than one. */
export function SectionTabs({ badges, path }: { badges: Partial<Record<BadgeKey, number>>; path?: string }) {
  const current = usePathname();
  const here = locate(path ?? current);
  if (!here || here.section.pages.length < 2) return null;
  return (
    <nav className="adm-tabs" aria-label={`${here.section.label} pages`}>
      {here.section.pages.map((p) => {
        const on = p.href === here.page.href;
        const n = p.badge ? (badges[p.badge] ?? 0) : 0;
        return (
          <Link key={p.href} href={p.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
            {p.label}
            <Count n={n} label={`${n} waiting`} />
          </Link>
        );
      })}
    </nav>
  );
}
