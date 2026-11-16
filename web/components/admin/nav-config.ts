// The admin console's map: a few sections in the left menu, and tabs inside a section for its pages.
// Every page keeps its own address (links, bookmarks and the buttons in notification emails still work).
// A badge counts what is waiting for the owner (lib/admin-badges.ts).

export type BadgeKey = "feedback" | "problems" | "crashes" | "pilot" | "experts";
export type NavPage = { href: string; label: string; badge?: BadgeKey };
export type NavSection = { key: string; label: string; pages: NavPage[] };

export const SECTIONS: NavSection[] = [
  { key: "overview", label: "Overview", pages: [{ href: "/admin", label: "Overview" }] },
  {
    key: "people",
    label: "Users",
    pages: [
      { href: "/admin/users", label: "Users" },
      { href: "/admin/downloads", label: "Downloads" },
    ],
  },
  {
    key: "money",
    label: "Money",
    pages: [
      { href: "/admin/finance", label: "Finance" },
      { href: "/admin/costs", label: "Costs" },
    ],
  },
  {
    key: "theoovi",
    label: "theOovi",
    pages: [
      { href: "/admin/ai", label: "Settings" },
      { href: "/admin/usage", label: "Usage" },
    ],
  },
  {
    key: "programs",
    label: "Pilot & experts",
    pages: [
      { href: "/admin/pilot", label: "Pilot", badge: "pilot" },
      { href: "/admin/experts", label: "Experts", badge: "experts" },
    ],
  },
  {
    key: "comms",
    label: "Communication",
    pages: [
      { href: "/admin/announcements", label: "Announcements" },
      { href: "/admin/email", label: "Email" },
      { href: "/admin/releases", label: "Release notes" },
    ],
  },
  {
    key: "quality",
    label: "Quality",
    pages: [
      { href: "/admin/problems", label: "Problems", badge: "problems" },
      { href: "/admin/feedback", label: "Feedback", badge: "feedback" },
      { href: "/admin/crashes", label: "Crashes", badge: "crashes" },
    ],
  },
  { key: "marketplace", label: "Marketplace", pages: [{ href: "/admin/marketplace", label: "Marketplace" }] },
  { key: "reports", label: "Reports", pages: [{ href: "/admin/reports", label: "Reports" }] },
  { key: "audit", label: "Audit log", pages: [{ href: "/admin/audit", label: "Audit log" }] },
];

/** The page a path belongs to (the longest matching address), and its section. */
export function locate(pathname: string): { section: NavSection; page: NavPage } | null {
  let best: { section: NavSection; page: NavPage } | null = null;
  for (const section of SECTIONS)
    for (const page of section.pages) {
      const hit = page.href === "/admin" ? pathname === "/admin" : pathname === page.href || pathname.startsWith(`${page.href}/`);
      if (hit && (!best || page.href.length > best.page.href.length)) best = { section, page };
    }
  return best;
}
