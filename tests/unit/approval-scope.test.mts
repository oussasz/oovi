// Fewer approval cards, same safety (lib/approval-scope-core.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { addGrants, cleanSite, granted, hostOf, reachesOthers, scopeOf, siteAllowed } from "../../lib/approval-scope-core.ts";

test("what one OK can cover", () => {
  assert.deepEqual(scopeOf("click", "https://www.Facebook.com/page/x"), { key: "site:facebook.com", kind: "site", label: "facebook.com" });
  assert.equal(scopeOf("browser_steps", "https://shop.dz/cart")?.key, "site:shop.dz");
  assert.equal(scopeOf("click", "about:blank"), null);
  assert.equal(scopeOf("click", "file:///C:/x.html"), null);
  assert.equal(scopeOf("upload_file", "https://shop.dz"), null, "a file leaving the computer always asks");
  assert.equal(scopeOf("fill_login", "https://shop.dz"), null, "a saved password always asks");
  assert.equal(scopeOf("desktop_click"), null);
  assert.equal(scopeOf("save_skill"), null);
  assert.equal(scopeOf("propose_routine"), null);
  assert.deepEqual(scopeOf("mcp_gmail_send_email"), { key: "tool:mcp_gmail_send_email", kind: "tool", label: "gmail send email" });
  assert.equal(scopeOf("mcp_drive_delete_file"), null, "deleting always asks");
  assert.equal(scopeOf("mcp_hubspot_update_contact", null, { destructive: true }), null);
});

test("allowed for this chat, or always on a site (and its sub-sites, not look-alikes)", () => {
  const s = scopeOf("type", "https://m.facebook.com/x")!;
  assert.ok(granted(s, ["site:m.facebook.com"], []));
  assert.ok(granted(s, [], ["facebook.com"]));
  assert.ok(!granted(s, [], ["book.com"]));
  assert.ok(!siteAllowed("evilfacebook.com", ["facebook.com"]));
  assert.ok(!granted(scopeOf("mcp_gmail_send_email"), [], ["gmail.com"]), "a site setting never covers connector actions");
  assert.ok(!granted(null, ["anything"], ["x.com"]));
});

test("sends wait a moment; reading doesn't", () => {
  assert.ok(reachesOthers("mcp_gmail_send_email"));
  assert.ok(reachesOthers("mcp_slack_post_message"));
  assert.ok(!reachesOthers("mcp_gmail_search_emails"));
  assert.ok(!reachesOthers("click"));
  assert.ok(reachesOthers("mcp_zapier_execute_zapier_write_action") === false, "Zapier's generic write action: decided by its card");
  assert.ok(reachesOthers("mcp_sendEmail"));
});

test("small helpers", () => {
  assert.deepEqual(addGrants(["a"], ["a", "b", ""]), ["a", "b"]);
  assert.equal(addGrants(Array.from({ length: 120 }, (_, i) => `k${i}`), ["new"]).length, 100);
  assert.equal(cleanSite(" https://www.Shop.dz/path "), "shop.dz");
  assert.equal(cleanSite("shop.dz"), "shop.dz");
  assert.equal(cleanSite("javascript:alert(1)"), null);
  assert.equal(hostOf("ftp://x.dz"), null);
});
