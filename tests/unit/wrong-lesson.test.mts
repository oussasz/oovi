import { test } from "node:test";
import assert from "node:assert/strict";

import { WRONG_LESSON } from "../../lib/lesson-rules.ts";

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
