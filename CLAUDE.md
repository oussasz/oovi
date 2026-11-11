# Working on oovi: the owner's rules

Read `docs/HANDOFF.md` first for where the product stands.

## Verify, never assume (most important)
- Never state something as fact about the owner's app, data or users unless you checked it. The owner's bots, names, settings and toggles can differ from the defaults in code (`lib/store.ts`). If you can't see it, say "I can't see that from here", show how to check it, or ask.
- Separate clearly what is **verified** (code read, test run, file and line), what is **seen** (in a screenshot or a message), and what is **assumed**. Never mix them.
- Before explaining a bug, read the code path that produces it and quote the file:line. Before saying something works, run it (unit tests, `tests/e2e/*.cjs`, the built server, a browser) and report the real result.
- Treat every change as if it ships to millions of users. Review it as a product manager, senior engineer, UX researcher, UI designer, QA, security and performance engineer: functionality, usability, accessibility, edge cases, errors, security, performance, consistency. Challenge your own design; fix weaknesses before presenting.
- Recommend only what is production-ready, internally consistent and checked. If you corrected yourself, say so plainly.

## Owner's other rules
- Confirm before anything outward or hard to undo: releases, store submissions, sending messages. Don't publish a version until the owner says so.
- Never ask for passwords or keys in chat; never enter passwords or create accounts; test with stand-ins, a fresh data folder or a throwaway local database.
- Write for people: plain words, short. Users write in Arabic (incl. Algerian Darija), French and English.
- "We win in the harness, not in the model": no automatic switch to a bigger model to fix quality; cost matters.
- The owner is not a developer: do the work end to end, and give exact links and clicks for the steps only they can do.

## Before every release
`npx tsc --noEmit`, `cd tests/unit && node --test`, `npm run build`, then `node tests/e2e/group-scenario.cjs`, `node tests/e2e/spec-scenario.cjs`, `node tests/e2e/phase1-scenario.cjs`, `node tests/e2e/bigjob-scenario.cjs`, `node tests/e2e/parallel-scenario.cjs`, `node tests/e2e/telegram-scenario.cjs`. All must pass.
