// Reads what a page shows outside its own text: embedded frames and web components (lib/page-extra-core.ts).
import type { Page } from "playwright-core";
import { frameAllowed, MAX_FRAMES, SHADOW_TEXT_JS } from "./page-extra-core";

/** Scrolls once to the bottom and back, so content that loads on scroll is there when the page is read. */
export async function scrollOnce(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      window.scrollTo(0, document.body ? document.body.scrollHeight : 0);
      await new Promise((r) => setTimeout(r, 700));
      window.scrollTo(0, 0);
    })
    .catch(() => {});
}

/** Text of the page's web components and of up to MAX_FRAMES embedded frames (never a private address unless allowed). */
export async function embeddedParts(page: Page, allowPrivate: boolean): Promise<{ where: string; text: string }[]> {
  const out: { where: string; text: string }[] = [];
  const shadow = (await page.evaluate(SHADOW_TEXT_JS).catch(() => [])) as string[];
  for (const t of Array.isArray(shadow) ? shadow : []) out.push({ where: "", text: String(t) });
  const frames = page.frames().filter((f) => f !== page.mainFrame() && frameAllowed(f.url(), allowPrivate)).slice(0, MAX_FRAMES);
  for (const f of frames) {
    const text = (await Promise.race([
      f.evaluate(() => (document.body ? document.body.innerText : "")).catch(() => ""),
      new Promise<string>((r) => setTimeout(() => r(""), 3000)),
    ])) as string;
    if (text.trim()) out.push({ where: f.url(), text });
  }
  return out;
}
