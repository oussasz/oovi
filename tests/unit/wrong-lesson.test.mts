import { test } from "node:test";
import assert from "node:assert/strict";

import { TECHNICAL_LESSON, WRONG_LESSON } from "../../lib/lesson-rules.ts";

test("the wrong 'tunnel is down' lessons are recognised", () => {
  for (const t of [
    "If a dashboard link returns empty pages via open_url and read_url says it needs JavaScript, the tunnel is likely down. Ask the owner to restart it instead of retrying.",
    "Le tunnel trycloudflare est probablement coupé : demander de relancer.",
    "Blank page means the site is offline.",
  ]) assert.ok(WRONG_LESSON.test(t), t);
});

test("good lessons are kept", () => {
  for (const t of [
    "The Business OS link was posted in the group chat, so check the group messages for shared links before asking the user to resend them.",
    "For flight prices, Google Flights pages need the browser; read_url returns no prices.",
    "Don't present figures or deadlines from earlier dashboard reads as current. Re-read them or label them unverified.",
    "The user's Business OS dashboard is shared via a trycloudflare tunnel link that can change.",
  ]) assert.ok(!WRONG_LESSON.test(t), t);
});

test("notes about oovi's own tools are not lessons (the ones the owner saw on the card)", () => {
  for (const t of [
    "For phone numbers, a web_search snippet is not enough: open the listing page with read_url to confirm the full number and its URL before recording it.",
    "On DzAdvisor and pagesjaunes-dz listing pages, read_url returned no readable phone numbers in the text. Use another source for those numbers instead of retrying them.",
    "Pour les numéros de commerces algériens, les extraits de recherche ne suffisent pas : ouvrir chaque fiche avant de marquer un numéro comme trouvé.",
    "Google Flights pages need the browser; read_url returns no prices.",
    "The API returned a 429 error, wait before the next tool call.",
    "Hand-offs ran out before the list was complete; announce the rhythm earlier.",
  ]) assert.ok(TECHNICAL_LESSON.test(t), t);
});

test("lessons about the user's work are kept", () => {
  for (const t of [
    "The user's company files are in the Reports folder; check there first.",
    "For m3ak prospect lists, the user wants a phone number for every row, in an Excel file.",
    "The user wants replies in short bullet points, no tables.",
    "Les factures de la société sont envoyées à Samir chaque lundi.",
    "المستخدم يريد التقارير بصيغة PDF باللغة العربية.",
  ]) assert.ok(!TECHNICAL_LESSON.test(t), t);
});
