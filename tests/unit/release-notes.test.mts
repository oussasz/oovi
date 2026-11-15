import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_HEADLINE, SECTION_TITLES, checkText, compareVersions, itemsFromText, normalizeNotes, parseTemplate, resolveNotes, stripBoilerplate,
} from "../../web/lib/release-notes.ts";
import { SEED_NOTES } from "../../web/lib/release-notes-seed.ts";

const MARKETPLACE_NEWS = /new (one-click )?connectors?:|new expert|skills library|\bnew teams\b|\bnew (expert )?bots\b/i;

// Every version released so far has polished text, in one shape.
const RELEASED = ["0.10.13","0.10.12","0.10.11","0.10.10","0.10.9","0.10.8","0.10.7","0.10.6","0.10.5","0.10.4","0.10.3","0.10.2","0.10.1","0.10.0","0.9.0","0.8.9","0.8.8","0.8.7","0.8.6","0.8.5","0.8.4","0.8.3","0.8.2","0.8.1","0.8.0","0.7.0","0.6.0","0.5.0","0.4.1"];

test("the shipped text covers every released version", () => {
  assert.deepEqual(Object.keys(SEED_NOTES).sort(compareVersions), [...RELEASED].sort(compareVersions));
});

test("every shipped version is in the standard shape, short and clean", () => {
  for (const [v, notes] of Object.entries(SEED_NOTES)) {
    assert.deepEqual(normalizeNotes(notes), notes, `${v} changes when normalised (empty section, long line or odd character?)`);
    if (notes.hidden) continue;
    assert.ok(notes.sections.length > 0, `${v} has no points`);
    assert.ok((notes.headline ?? "").length <= MAX_HEADLINE, `${v} headline`);
    assert.ok(!MARKETPLACE_NEWS.test(notes.headline ?? ""), `${v} headline announces Marketplace content`);
    const order = notes.sections.map((s) => SECTION_TITLES.indexOf(s.title));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${v} sections out of order`);
    for (const s of notes.sections) for (const it of s.items) {
      assert.ok(!/github|feedback from|token|prefill|blockmap/i.test(it), `${v}: internal word in "${it.slice(0, 50)}"`);
      assert.ok(!MARKETPLACE_NEWS.test(it), `${v}: Marketplace additions are not app updates: "${it.slice(0, 50)}"`);
      assert.ok(it.length >= 20, `${v}: too short "${it}"`);
    }
  }
});

test("the same notes are not shown twice (0.8.3 and 0.8.4 repeat 0.8.5 and are hidden)", () => {
  assert.equal(SEED_NOTES["0.8.3"]!.hidden, true);
  assert.equal(SEED_NOTES["0.8.4"]!.hidden, true);
  assert.equal(SEED_NOTES["0.8.5"]!.hidden, undefined);
});

test("newest version first", () => {
  assert.deepEqual(["0.9.0", "0.10.2", "0.8.9", "0.10.13"].sort(compareVersions), ["0.10.13", "0.10.2", "0.9.0", "0.8.9"]);
});

test("install steps, the title line and links to the code host are removed from a release's own notes", () => {
  const body = "## What's new in oovi 0.8.0\r\n\r\n**A thing.** Done.\r\n\r\n### Updating\r\noovi updates itself.\r\n\r\nThe app isn't code-signed yet:\r\n- Mac: right-click\r\n\r\n### Good to know\r\n- Keep this\r\nSee https://github.com/x/y\r\n";
  const out = stripBoilerplate(body);
  assert.ok(out.includes("**A thing.**") && out.includes("Keep this"));
  assert.ok(!/Updating|updates itself|Mac: right|github|What's new in oovi/i.test(out));
  const dl = stripBoilerplate("## Download\n- **Mac:** `a.dmg`\n\n## New\n- Real point here");
  assert.ok(!dl.includes("a.dmg") && dl.includes("Real point here"));
});

test("a new release written with the template needs no editing", () => {
  const n = parseTemplate("### New\n- **Title.** A sentence.\n### Fixed\n- A thing that was wrong.\n\n### Updating\nboilerplate")!;
  assert.deepEqual(n.sections.map((s) => s.title), ["New", "Fixed"]);
  assert.equal(parseTemplate("## What's new in oovi 1.0.0\n\n**Bold paragraph.** old style"), null);
  assert.equal(parseTemplate("### Something else\n- x"), null);
});

test("what is shown: your edit, then the shipped text, then the release's notes, then the release as written", () => {
  const edited = { "0.10.13": { headline: "Mine", sections: [{ title: "New" as const, items: ["**Mine.** Yes."] }] } };
  const a = resolveNotes("0.10.13", "### New\n- x here ok", edited, SEED_NOTES);
  assert.ok(a.kind === "notes" && a.source === "edited" && a.notes.headline === "Mine");
  const b = resolveNotes("0.10.13", "", {}, SEED_NOTES);
  assert.ok(b.kind === "notes" && b.source === "default");
  const c = resolveNotes("0.99.0", "### New\n- **Title.** Sentence here.", {}, SEED_NOTES);
  assert.ok(c.kind === "notes" && c.source === "github");
  const d = resolveNotes("0.99.0", "## What's new in oovi 0.99.0\n\n**Old style.** text", {}, SEED_NOTES);
  assert.ok(d.kind === "legacy" && d.markdown.includes("Old style"));
  assert.equal(resolveNotes("0.8.3", "", {}, SEED_NOTES).kind, "hidden");
  assert.equal(resolveNotes("0.8.3", "", { "0.8.3": { sections: [{ title: "New", items: ["**Shown again.** Yes."] }] } }, SEED_NOTES).kind, "notes");
});

test("what the admin types: one point per line, bullets allowed, nothing empty", () => {
  assert.deepEqual(itemsFromText("- **A.** One\n\n* Two two\r\n  • Three  \n"), ["**A.** One", "Two two", "Three"]);
  assert.deepEqual(checkText("", { New: "", Improved: "", Fixed: "", "Good to know": "" }), ["Write at least one point, or hide this version instead."]);
  assert.deepEqual(checkText("ok", { New: "a point", Improved: "", Fixed: "", "Good to know": "" }), []);
  assert.ok(checkText("x".repeat(MAX_HEADLINE + 1), { New: "a", Improved: "", Fixed: "", "Good to know": "" })[0]!.includes("headline"));
  assert.ok(checkText("", { New: "see https://github.com/a/b", Improved: "", Fixed: "", "Good to know": "" }).some((e) => e.includes("code host")));
  assert.equal(normalizeNotes({ sections: [{ title: "Hack", items: ["x"] }, { title: "New", items: [1, "ok"] }] }).sections.length, 1);
});
