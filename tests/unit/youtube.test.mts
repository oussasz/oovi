import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isYoutubeSearch, youtubeList, youtubeVideos } from "../../lib/youtube-core.ts";

const page = (items: unknown[]) =>
  `<html><script>var ytInitialData = ${JSON.stringify({ contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: items } }] } } } } })};</script></html>`;
const video = (id: string, title: string, channel: string, length = "5:13") => ({
  videoRenderer: { videoId: id, title: { runs: [{ text: title }] }, ownerText: { runs: [{ text: channel }] }, lengthText: { simpleText: length }, viewCountText: { simpleText: "1,234,567 views" } },
});

test("a YouTube search page gives the videos with their watch links, in order", () => {
  const html = page([{ adSlotRenderer: {} }, video("MeRBFIywDQU", "Mahfoud et Sonia - 123 viva l'algérie", "Edition SunClair"), { channelRenderer: { channelId: "x" } }, video("CYLOnlBb0CY", "One Two Three Viva L'Algérie {with \"braces\"}", "Someone", "3:01")]);
  const v = youtubeVideos(html);
  assert.equal(v.length, 2);
  assert.deepEqual(v[0], { id: "MeRBFIywDQU", title: "Mahfoud et Sonia - 123 viva l'algérie", channel: "Edition SunClair", length: "5:13", views: "1,234,567 views", url: "https://www.youtube.com/watch?v=MeRBFIywDQU" });
  assert.match(youtubeList("123 viva l'algerie", v), /1\. Mahfoud et Sonia.*Edition SunClair \(5:13\)[\s\S]*watch\?v=MeRBFIywDQU[\s\S]*starts by itself/);
});

test("only search pages, and nothing when the data isn't there", () => {
  assert.equal(isYoutubeSearch("https://www.youtube.com/results?search_query=123+viva"), true);
  assert.equal(isYoutubeSearch("https://m.youtube.com/results?search_query=x"), true);
  assert.equal(isYoutubeSearch("https://www.youtube.com/watch?v=MeRBFIywDQU"), false);
  assert.equal(isYoutubeSearch("https://evil.example/results?search_query=x&youtube.com"), false);
  assert.deepEqual(youtubeVideos("<html>consent page</html>"), []);
});

// A real page saved once (if present on this machine) must parse too.
const real = "/tmp/claude-0/s/yt.html";
test("a real YouTube results page", { skip: !fs.existsSync(real) }, () => {
  const v = youtubeVideos(fs.readFileSync(real, "utf8"));
  assert.ok(v.length >= 5);
  assert.ok(v.every((x) => /^[\w-]{11}$/.test(x.id) && x.title));
  console.log(v.slice(0, 3).map((x) => `${x.title} — ${x.channel} (${x.length})`).join("\n"));
});
