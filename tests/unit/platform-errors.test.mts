import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdit, hostedCode, isGitPath, launchSummary, lineEnding, netCode, netKind, netReason, parseUserDirs, pickLaunchError, shellCommand } from "../../lib/platform-errors-core.ts";

/** What Node's fetch throws: "fetch failed" with the real code on cause. */
const fetchFailed = (code: string, message = code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(message), { code }) });

test("certificate errors (antivirus HTTPS scanning, company proxy) are 'tls', not offline", () => {
  for (const code of ["SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "ERR_SSL_WRONG_VERSION_NUMBER"]) {
    assert.equal(netKind(fetchFailed(code)), "tls", code);
  }
  assert.match(netReason(fetchFailed("SELF_SIGNED_CERT_IN_CHAIN")), /security program.*SELF_SIGNED_CERT_IN_CHAIN/);
});

test("DNS failures are offline; other codes are neither", () => {
  assert.equal(netKind(fetchFailed("ENOTFOUND")), "offline");
  assert.equal(netKind(fetchFailed("EAI_AGAIN")), "offline");
  assert.equal(netKind(fetchFailed("ECONNREFUSED")), "other");
  assert.equal(netKind(new TypeError("fetch failed")), "other");
  assert.match(netReason(fetchFailed("ECONNREFUSED")), /nothing is answering/);
  assert.match(netReason(fetchFailed("ENOTFOUND")), /no internet/);
});

test("the code is found deep in the cause chain and in AggregateError (happy eyeballs)", () => {
  const agg = Object.assign(new AggregateError([Object.assign(new Error("x"), { code: "ENETUNREACH" })]), { code: undefined });
  assert.equal(netCode(Object.assign(new TypeError("fetch failed"), { cause: agg })), "ENETUNREACH");
  const deep = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("wrap"), { code: "UND_ERR_CONNECT", cause: Object.assign(new Error("c"), { code: "CERT_HAS_EXPIRED" }) }) });
  assert.equal(netCode(deep), "CERT_HAS_EXPIRED");
  assert.equal(netKind(deep), "tls");
});

test("theOovi error codes: busy only for passing statuses; bugs and 500s get no code (they are reported)", () => {
  assert.equal(hostedCode(0), "offline");
  assert.equal(hostedCode(0, "tls"), "tls");
  assert.equal(hostedCode(401), "signed_out");
  for (const s of [429, 502, 503, 504, 529]) assert.equal(hostedCode(s), "busy", String(s));
  for (const s of [400, 404, 413, 422, 500]) assert.equal(hostedCode(s), undefined, String(s));
  assert.equal(hostedCode(402, "no_credits"), "no_credits");
  assert.equal(hostedCode(400, "context_too_large"), "context_too_large");
});

test("browser launch: the first telling error wins over 'not installed', with the browser's name", () => {
  const chrome = new Error("browserType.launch: Failed to launch the browser process.\nBrowser logs:\n\n[pid=12][err] [12:12:ERROR:process_singleton_posix.cc(345)] Failed to create SingletonLock: File exists (17)\nCall log:\n  - <launching> /opt/google/chrome/chrome --headless");
  const edge = new Error("browserType.launch: Chromium distribution 'msedge' is not found at /opt/microsoft/msedge/msedge\nRun \"npx playwright install msedge\"");
  const pw = new Error("browserType.launch: Executable doesn't exist at /home/u/.cache/ms-playwright/chromium-1200/chrome-linux/chrome");
  const e = pickLaunchError([
    { who: "Google Chrome", err: chrome },
    { who: "Microsoft Edge", err: edge },
    { who: "Playwright's Chromium", err: pw },
  ]);
  assert.match(e.message, /^Google Chrome couldn't start: browserType\.launch: Failed to launch the browser process\. .*SingletonLock/);
  assert.match(e.message, /tried: Google Chrome, Microsoft Edge, Playwright's Chromium/);
  assert.ok(!e.message.includes("\n"));
  // None telling: the last one (Playwright's own Chromium isn't installed), so the install hint still applies.
  const none = pickLaunchError([
    { who: "Microsoft Edge", err: edge },
    { who: "Playwright's Chromium", err: pw },
  ]);
  assert.match(none.message, /^Playwright's Chromium couldn't start: .*Executable doesn't exist/);
  // Chrome opening in an existing session (profile in use).
  assert.match(launchSummary(new Error("browserType.launchPersistentContext: Target page, context or browser has been closed\nBrowser logs:\n- [pid=5][out] Opening in existing browser session.")), /Opening in existing browser session/);
});

test(".git is protected in any case and Windows aliases", () => {
  for (const p of [".git", ".git/config", ".GIT/config", ".Git", ".git./config", ".git /hooks/x", ".git::$INDEX_ALLOCATION/config", "GIT~1/config", ".git\\hooks\\pre-commit"]) assert.ok(isGitPath(p), p);
  for (const p of [".github/workflows/x.yml", ".gitignore", "src/.git/x", "git/x", ".gitattributes"]) assert.ok(!isGitPath(p), p);
});

test("edit_file keeps a CRLF file all CRLF", () => {
  const text = "line one\r\nline two\r\nline three\r\n";
  // Multi-line old text sent with \n.
  const a = applyEdit(text, "line one\nline two", "first\nsecond\nextra", false);
  assert.equal(a.count, 1);
  assert.equal(a.next, "first\r\nsecond\r\nextra\r\nline three\r\n");
  // A single line found as-is: the new text's \n still becomes \r\n (no mixed endings).
  const b = applyEdit(text, "line two", "two\nand a half", false);
  assert.equal(b.next, "line one\r\ntwo\r\nand a half\r\nline three\r\n");
  assert.ok(!/[^\r]\n/.test(b.next!));
  // Old text sent with \r\n in an LF file still matches; the LF file stays LF.
  const c = applyEdit("a\nb\nc\n", "a\r\nb", "x\r\ny", false);
  assert.equal(c.next, "x\ny\nc\n");
  // Not found, and several matches without replace_all.
  assert.equal(applyEdit(text, "nope", "x", false).count, 0);
  const d = applyEdit("x\r\nx\r\n", "x", "y\nz", false);
  assert.deepEqual(d, { count: 2 });
  assert.equal(applyEdit("x\r\nx\r\n", "x", "y\nz", true).next, "y\r\nz\r\ny\r\nz\r\n");
  // "$&" in the new text is kept literally.
  assert.equal(applyEdit("a b", "b", "$&$1", false).next, "a $&$1");
  assert.equal(lineEnding("a\r\nb\nc\r\n"), "\r\n");
  assert.equal(lineEnding("a\nb\nc\r\n"), "\n");
});

test("run_command on Windows switches cmd.exe to UTF-8 first; other shells and systems are untouched", () => {
  assert.equal(shellCommand("dir && echo ok", "win32", "C:\\Windows\\system32\\cmd.exe"), "chcp 65001 >nul 2>&1 & dir && echo ok");
  assert.equal(shellCommand("dir", "win32", undefined), "chcp 65001 >nul 2>&1 & dir");
  assert.equal(shellCommand("ls", "win32", "C:\\Program Files\\PowerShell\\pwsh.exe"), "ls");
  assert.equal(shellCommand("ls -la", "linux", undefined), "ls -la");
  assert.equal(shellCommand("ls", "darwin", "cmd.exe"), "ls");
});

test("Linux user folders come from user-dirs.dirs, only inside home", () => {
  const conf = [
    "# This file is written by xdg-user-dirs-update",
    'XDG_DESKTOP_DIR="$HOME/Bureau"',
    'XDG_DOWNLOAD_DIR="$HOME/Téléchargements"',
    'XDG_DOCUMENTS_DIR="$HOME/"',
    'XDG_TEMPLATES_DIR="$HOME/Modèles"',
    'XDG_MUSIC_DIR="/etc"',
    'XDG_PICTURES_DIR="/home/sam/Images"',
    'XDG_VIDEOS_DIR="$HOME/../other"',
  ].join("\n");
  assert.deepEqual(parseUserDirs(conf, "/home/sam"), ["/home/sam/Bureau", "/home/sam/Téléchargements", "/home/sam/Images"]);
  assert.deepEqual(parseUserDirs("", "/home/sam"), []);
});
