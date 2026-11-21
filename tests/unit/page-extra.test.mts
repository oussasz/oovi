// Text inside embedded frames (a booking or menu widget, a form from another site) and inside web components
// (shadow DOM) never reached the bots: only the page's own text was read (lib/page-extra-core.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { EMBED_MAX, frameAllowed, mergeEmbedded, SHADOW_TEXT_JS } from "../../lib/page-extra-core.ts";

test("text from embedded parts is added after the page's own text, marked as embedded", () => {
  const out = mergeEmbedded("Welcome to Café Atlas.", [
    { where: "https://widget.booking.example/menu", text: "Menu: couscous 900 DA, chorba 400 DA" },
  ]);
  assert.match(out, /^Welcome to Café Atlas\./);
  assert.match(out, /Embedded in the page \(widget\.booking\.example\)/);
  assert.match(out, /couscous 900 DA/);
});

test("nothing is added twice, nothing empty, and the total stays bounded", () => {
  const main = "Opening hours: 8h to 22h every day.";
  const out = mergeEmbedded(main, [
    { where: "shadow", text: "Opening hours: 8h to 22h every day." },
    { where: "https://a.example/", text: "   " },
    { where: "https://b.example/", text: "x".repeat(EMBED_MAX * 3) },
  ]);
  assert.equal(out.split("Opening hours").length - 1, 1);
  assert.ok(out.length <= main.length + EMBED_MAX + 200, `${out.length}`);
  assert.equal(mergeEmbedded(main, []), main);
});

test("frames from private addresses, ads and trackers are not read", () => {
  assert.equal(frameAllowed("https://widget.booking.example/menu", false), true);
  assert.equal(frameAllowed("http://192.168.1.10/admin", false), false);
  assert.equal(frameAllowed("http://192.168.1.10/admin", true), true);
  assert.equal(frameAllowed("about:blank", false), false);
  assert.equal(frameAllowed("https://googleads.g.doubleclick.net/pagead/x", false), false);
  assert.equal(frameAllowed("https://www.googletagmanager.com/ns.html", false), false);
});

test("the shadow-DOM reader is a self-contained script", () => {
  assert.match(SHADOW_TEXT_JS, /shadowRoot/);
  assert.doesNotThrow(() => new Function(`return ${SHADOW_TEXT_JS}`));
});
