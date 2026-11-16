// The page an announcement's HTML is shown in (the app's window and the admin preview): a locked frame.
// The frame itself is sandboxed without scripts or same-origin (see AnnouncementFrame), and this page adds
// a Content-Security-Policy as a second lock: no scripts, no requests except images, fonts and styles.
// Links open in the person's browser (base target, popups leave the sandbox). The website has an identical
// copy of this file (tests/unit/announcements.test.mts). No imports, so tests run it as is.

export const FRAME_CSP = "default-src 'none'; img-src https: data:; media-src https:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:";
export const FRAME_SANDBOX = "allow-popups allow-popups-to-escape-sandbox";

const HEAD = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}"><base target="_blank"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.5}img,video{max-width:100%;height:auto}</style>`;

/** The full page for the frame's srcdoc, whether the HTML is a whole document or just its body. */
export function framedHtml(html: string): string {
  // Anything the author put before the policy (a <meta> refresh, a <base>) must not win: they are removed.
  const clean = String(html ?? "")
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<meta[^>]+http-equiv[^>]*>/gi, "")
    .replace(/<base[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  if (/<head[^>]*>/i.test(clean)) return clean.replace(/<head[^>]*>/i, (m) => `${m}${HEAD}`);
  if (/<html[^>]*>/i.test(clean)) return clean.replace(/<html[^>]*>/i, (m) => `${m}<head>${HEAD}</head>`);
  return `<!doctype html><html><head>${HEAD}</head><body>${clean}</body></html>`;
}
