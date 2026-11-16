import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { locate, SECTIONS } from "../../web/components/admin/nav-config.ts";

const ADMIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../web/app/admin");

/** Every page of the console, as its address (/admin/users/[id] → /admin/users/x). */
function pages(dir = ADMIN, at = "/admin"): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name === "page.tsx") out.push(at);
    if (e.isDirectory()) out.push(...pages(path.join(dir, e.name), `${at}/${e.name.replace(/^\[.*\]$/, "x")}`));
  }
  return out;
}

test("every admin page is in the menu, in one section", () => {
  const all = pages();
  assert.ok(all.length >= 20, `found ${all.length} pages`);
  for (const p of all) assert.ok(locate(p), `${p} isn't in any section of the admin menu`);
});

test("each page address appears once, and the owner's merges are kept together", () => {
  const hrefs = SECTIONS.flatMap((s) => s.pages.map((p) => p.href));
  assert.equal(new Set(hrefs).size, hrefs.length);
  const sectionOf = (h: string) => SECTIONS.find((s) => s.pages.some((p) => p.href === h))!.key;
  for (const group of [["/admin/finance", "/admin/costs"], ["/admin/ai", "/admin/usage"], ["/admin/pilot", "/admin/experts"], ["/admin/email", "/admin/announcements", "/admin/releases"], ["/admin/users", "/admin/downloads"]])
    assert.equal(new Set(group.map(sectionOf)).size, 1, group.join(" + "));
});

test("sub-pages light up their section (a user's page, an expert's application)", () => {
  assert.equal(locate("/admin/users/abc")!.page.href, "/admin/users");
  assert.equal(locate("/admin/experts/view")!.section.key, "programs");
  assert.equal(locate("/admin")!.section.key, "overview");
  assert.equal(locate("/admin/userstats"), null, "a prefix alone doesn't count");
});
