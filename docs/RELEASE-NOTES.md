# Release notes (the public "What's new" page)

Page: `/changelog`. Code: `web/lib/release-notes.ts`. Edit the words in **Admin › Release notes** (no code change, no new app version).

## Shape of every version
One optional headline (one line, max 100 characters), then these sections, in this order, each a list of points:

- **New**: things a person can do now that they couldn't before.
- **Improved**: things that were already there and are now better.
- **Fixed**: what was wrong, in the user's words.
- **Good to know** (optional): limits, privacy, anything that avoids a surprise.

A point is `**Short title.** One sentence.` Plain words, a person's point of view ("Bots finish what you ask"), one idea per point.

## What never goes in
- Code words (token, prefill, blockmap, API, endpoint…), file names, internal ids.
- Install or update instructions (the page has one box for those), code-signing warnings, download lists.
- Anyone's feedback, names, accounts or numbers from real users.
- Links to the code host. Promises about the future ("soon", "next week").
- New Marketplace items (a new expert, setup, connector or skill): they are added from the dashboard without an app update, so they are not release news. A change to how the Marketplace itself works is.
- Tiny internal changes nobody would notice: leave them out, or hide the version.
- Two versions with the same text: show the newest and hide the other.

## Where the page takes its words from (first match wins)
1. What was saved in Admin › Release notes (`app_config` key `release_notes`).
2. The polished text shipped with the site: `web/lib/release-notes-seed.ts` (all versions up to 0.10.13).
3. The GitHub release's own notes, if written with the template: `### New`, `### Improved`, `### Fixed`, `### Good to know`, each followed by `- ` points.
4. The GitHub release's own notes as written, minus the title line and the "Updating"/"Download" sections.

So for a new release, write its GitHub notes with the template (step 3) and the page shows it in the standard shape with no editing. Check the page after publishing; polish in Admin if needed.
