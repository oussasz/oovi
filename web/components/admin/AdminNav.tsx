"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/ai", label: "theOovi" },
  { href: "/admin/pilot", label: "Pilot" },
  { href: "/admin/feedback", label: "Feedback" },
  { href: "/admin/downloads", label: "Downloads" },
  { href: "/admin/crashes", label: "Crashes" },
  { href: "/admin/usage", label: "Usage" },
  { href: "/admin/marketplace", label: "Marketplace" },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="adm-nav" aria-label="Admin">
      <ul>
        {LINKS.map((l) => {
          const on = l.href === "/admin" ? pathname === "/admin" : pathname.startsWith(l.href);
          return (
            <li key={l.href}>
              <Link href={l.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
