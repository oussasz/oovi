// Teach by showing (lib/teach-core.ts): the user's steps become a skill a person can read; passwords never kept.
import test from "node:test";
import assert from "node:assert/strict";
import { addStep, cleanUrl, describeSteps, skillFromSteps, type TeachStep } from "../../lib/teach-core.ts";

const field = (label: string, extra = {}) => ({ tag: "input", type: "text", label, ...extra });
const run = (list: TeachStep[]) => list.reduce((acc, s) => addStep(acc, s), [] as TeachStep[]);

test("typing joins, repeated clicks and pages are noted once, unknown keys skipped", () => {
  const steps = run([
    { kind: "open", url: "https://shop.dz/login?session=abc&lang=fr#top" },
    { kind: "open", url: "https://shop.dz/login?lang=fr" },
    { kind: "click", target: field("Email") },
    { kind: "click", target: field("Email") },
    { kind: "type", target: field("Email"), text: "kar" },
    { kind: "type", target: field("Email"), text: "im@x.dz" },
    { kind: "click", target: field("Password", { type: "password", secret: true }) },
    { kind: "type", target: field("Password", { type: "password", secret: true }), text: "S3cret!" },
    { kind: "key", key: "Shift" },
    { kind: "key", key: "Enter" },
    { kind: "open", url: "https://shop.dz/account" },
    { kind: "click", target: { tag: "a", label: "Mes commandes" } },
  ]);
  assert.equal(steps.length, 8);
  assert.deepEqual(steps[0], { kind: "open", url: "https://shop.dz/login?lang=fr" });
  assert.equal((steps[2] as { text: string }).text, "karim@x.dz");
  assert.ok(!JSON.stringify(steps).includes("S3cret"), "a password is never kept");
});

test("the steps read as plain sentences", () => {
  const lines = describeSteps(
    run([
      { kind: "open", url: "https://shop.dz/login" },
      { kind: "click", target: field("Email") },
      { kind: "type", target: field("Email"), text: "karim@x.dz" },
      { kind: "type", target: field("Mot de passe", { type: "password", secret: true }), text: "x" },
      { kind: "click", target: { tag: "button", label: "Se connecter", type: "submit" } },
      { kind: "open", url: "https://shop.dz/account", title: "Mon compte" },
      { kind: "click", target: { tag: "select", label: "Wilaya" } },
      { kind: "click", target: { tag: "div", role: "option", label: "Oran" } },
      { kind: "key", key: "Enter" },
    ]),
  );
  assert.deepEqual(lines, [
    "1. Open https://shop.dz/login",
    "2. Type “karim@x.dz” in the “Email” field (the user typed this as an example: use the value the task needs).",
    "3. Type the password in the “Mot de passe” field (use fill_login with the saved login; never ask the user to type it in the chat).",
    "4. Click the “Se connecter” button.",
    "5. The page https://shop.dz/account opens (“Mon compte”).",
    "6. Click the “Wilaya” list.",
    "7. Click “Oran”.",
    "8. Press Enter.",
  ]);
});

test("a skill with a name, a description and steps to follow", () => {
  const s = skillFromSteps(run([{ kind: "open", url: "https://www.shop.dz/" }, { kind: "click", target: { tag: "a", label: "Orders" } }]), "", "Download last month's invoices");
  assert.equal(s.name, "Steps on shop.dz");
  assert.equal(s.description, "Download last month's invoices");
  assert.match(s.body, /^The user showed how to do this in the bots' browser on shop\.dz/);
  assert.match(s.body, /Goal: Download last month's invoices\n\n1\. Open https:\/\/www\.shop\.dz\/\n2\. Click the link “Orders”\./);
});

test("addresses lose tokens and other people's data; only web pages count", () => {
  assert.equal(cleanUrl("https://a.dz/p?id=4&token=x&email=k@x.dz&code=1"), "https://a.dz/p?id=4");
  assert.equal(cleanUrl("javascript:alert(1)"), "");
  assert.equal(cleanUrl("about:blank"), "");
});
