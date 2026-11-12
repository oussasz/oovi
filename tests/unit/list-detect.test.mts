import { test } from "node:test";
import assert from "node:assert/strict";
import { listHint, listInfo } from "../../lib/list-detect.ts";

const page = (body: string) => `<!doctype html><html><head><title>x</title></head><body>${body}</body></html>`;
const NAV = `<nav><ul>${Array.from({ length: 12 }, (_, i) => `<li><a href="/c${i}">Catégorie numéro ${i}</a></li>`).join("")}</ul></nav>`;

test("a directory page is a list: its items, phones and next page are found, not its menu", () => {
  const items = Array.from({ length: 40 }, (_, i) => `<div class="card r${1000 + i}"><h3>Usine numéro ${i}</h3><p>Zone Taharacht, Akbou</p>${i % 4 ? `<p>034 35 ${String(10 + i).padStart(2, "0")} 12</p>` : ""}</div>`).join("");
  const info = listInfo(page(`${NAV}<main><div class="results">${items}</div><a href="/p2">Suivant »</a></main>`))!;
  assert.equal(info.items, 40);
  assert.equal(info.phones, 30);
  assert.equal(info.next, true);
  assert.match(info.sample[0]!, /^Usine numéro 0/);
  assert.match(listHint(info, "https://dir.example/akbou"), /This page is a list of about 40 items \(30 show a phone number\), and it has more pages\. To keep them all, call scrape_list with url="https:\/\/dir\.example\/akbou"/);
});

test("an article is not a list; a short menu is not either", () => {
  const article = page(`${NAV}<article>${Array.from({ length: 6 }, () => `<p>${"Un long paragraphe sur l'industrie à Akbou. ".repeat(20)}</p>`).join("")}</article>`);
  assert.equal(listInfo(article), null);
  assert.equal(listHint(null, "x"), "");
});
