// When does a new message mean "go on with the job that stopped"? (lib/resume-core.ts). Before, every message
// written within a day of an unfinished job was read as "continue it", so a new request was answered with
// old work: the bots kept returning to finished topics.
import test from "node:test";
import assert from "node:assert/strict";
import { resumesJob } from "../../lib/resume-core.ts";

test("a short word to go on resumes the job, in the user's languages", () => {
  for (const t of ["retry", "continue", "go on", "do it", "ok", "yes go ahead", "it works now", "done, retry", "connecté", "c'est bon", "réessaie", "vas-y", "continue stp", "كمل", "كمّل", "واصل", "عاود", "عاود جرب", "زيد كمل", "أيه كمل", "ربطته", "kemel", "3awed", "zid"]) assert.equal(resumesJob(t), true, t);
});

test("a new request does not: it is answered for itself", () => {
  for (const t of [
    "ابعث إيمايل لكل واحد في القائمة",
    "send an email to everyone in the list",
    "what's the weather in Algiers tomorrow?",
    "ok now write me a post about our new product for Facebook please",
    "continue with the Facebook post and also check my calendar for tomorrow morning and tell me what I have",
    "شغل أغنية في يوتوب",
    "",
  ]) assert.equal(resumesJob(t), false, t);
});
