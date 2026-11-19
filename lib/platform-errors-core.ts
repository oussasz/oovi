// Pure helpers for errors and differences between Windows, macOS and Linux: why a network call failed,
// which browser launch error to show, line endings, the cmd.exe code page, protected .git paths, and the
// Linux user folders (XDG). Self-contained (no imports): unit-tested in tests/unit/platform-errors.test.mts.

// ---------- network failures ----------

/** Why a fetch failed: "tls" (a certificate problem), "offline" (no internet / name not found), or "other". */
export type NetKind = "tls" | "offline" | "other";

/**
 * The error code behind a failed fetch. Node's fetch only says "fetch failed"; the real code
 * (ENOTFOUND, SELF_SIGNED_CERT_IN_CHAIN…) is on e.cause, sometimes one or two levels down.
 */
export function netCode(e: unknown): string | undefined {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && code && code !== "UND_ERR_CONNECT" && code !== "ERR_INVALID_STATE") return code;
    const errs = (cur as { errors?: unknown }).errors;
    if (Array.isArray(errs) && errs.length) {
      const inner = netCode(errs[0]);
      if (inner) return inner;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

const TLS_CODE = /CERT|SELF_SIGNED|UNABLE_TO_(GET|VERIFY)|ERR_TLS|ERR_SSL/i;
const OFFLINE_CODE = /^(ENOTFOUND|EAI_AGAIN|EAI_NONAME|ENETUNREACH|ENETDOWN|EHOSTUNREACH)$/;

export function netKind(e: unknown): NetKind {
  const code = netCode(e);
  if (code && TLS_CODE.test(code)) return "tls";
  if (code && OFFLINE_CODE.test(code)) return "offline";
  // Some failures carry the reason only in the message.
  const msg = String((e as Error)?.message ?? "") + " " + String(((e as { cause?: Error })?.cause as Error | undefined)?.message ?? "");
  if (/certificate|self[- ]signed|unable to (get|verify)/i.test(msg)) return "tls";
  return "other";
}

/** A short reason for a failed connection, in plain words, with the code for support. */
export function netReason(e: unknown): string {
  const code = netCode(e);
  const kind = netKind(e);
  if (kind === "tls")
    return `a security program (antivirus) or your company network is blocking the secure connection, or this computer's date and time are wrong${code ? ` (${code})` : ""}`;
  if (kind === "offline") return `no internet connection, or the address can't be found${code ? ` (${code})` : ""}`;
  if (code === "ECONNREFUSED") return "nothing is answering at that address (ECONNREFUSED)";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return `the connection was cut (${code})`;
  if (code) return code;
  return String((e as Error)?.message ?? e);
}

// ---------- browser launch ----------

/** A launch error that only says the browser isn't installed there: try the next one, and don't show it if another error says more. */
export const NOT_INSTALLED = /Executable doesn't exist|is not found at|not found at|Chromium distribution '[^']+' is not found|ENOENT/i;

/** Lines of a Playwright launch error that tell the real reason (Chrome's log lines). */
const TELLING = /ProcessSingleton|profile|in use|existing browser session|policy|permission denied|EACCES|EPERM|snap|confinement|cannot open|could not|failed to|error/i;

/** One line saying why a browser couldn't start: the first line, plus the most telling log line after it. */
export function launchSummary(err: unknown): string {
  const msg = String((err as Error)?.message ?? err ?? "");
  const lines = msg
    .split(/\r?\n/)
    .map((l) =>
      l
        // eslint-disable-next-line no-control-regex
        .replace(/\u001b\[[0-9;]*m/g, "")
        .replace(/[═-╬]/g, "")
        .replace(/^\s*-\s*/, "")
        .replace(/^(\[pid=\d+\])?(\[err\]|\[out\])?\s*/, "")
        .trim(),
    )
    .filter(Boolean);
  const first = lines[0] ?? "it didn't start";
  const telling = lines.slice(1).find((l) => TELLING.test(l) && !/^(Browser logs:|Call log:|<launching>|<launched>)/i.test(l));
  return (telling && !first.includes(telling) ? `${first} ${telling}` : first).slice(0, 500);
}

/**
 * The error to show when no browser could start: the first one that isn't "not installed"
 * (it says why Edge or Chrome failed: profile in use, a policy…), else the last one, with the browser's name.
 */
export function pickLaunchError(attempts: { who: string; err: unknown }[]): Error {
  if (!attempts.length) return new Error("No browser could be started.");
  const telling = attempts.find((a) => !NOT_INSTALLED.test(String((a.err as Error)?.message ?? a.err)));
  const a = telling ?? attempts[attempts.length - 1]!;
  const tried = attempts.map((x) => x.who).join(", ");
  const e = new Error(`${a.who} couldn't start: ${launchSummary(a.err)} (tried: ${tried})`);
  (e as Error & { cause?: unknown }).cause = a.err;
  return e;
}

// ---------- files ----------

/**
 * Paths bots may not change: .git and anything inside it, in any letter case (Windows and macOS ignore case).
 * Also the names Windows treats as the same folder: trailing dots or spaces (".git."), a stream suffix
 * (".git::$INDEX_ALLOCATION") and the short 8.3 name ("GIT~1").
 */
export function isGitPath(rel: string): boolean {
  const first = rel.replace(/\\/g, "/").split("/")[0]!.toLowerCase();
  return /^\.git[. ]*(::?\$[a-z_]*)?$/.test(first) || /^git~\d+$/.test(first);
}

/** The file's main line ending: CRLF when most of its line breaks are CRLF. */
export function lineEnding(text: string): "\r\n" | "\n" {
  const crlf = text.split("\r\n").length - 1;
  if (!crlf) return "\n";
  const lf = text.split("\n").length - 1 - crlf;
  return crlf >= lf ? "\r\n" : "\n";
}

const count = (text: string, part: string) => (part ? text.split(part).length - 1 : 0);

/**
 * edit_file's replacement, keeping the file's line endings. Bots usually send \n: in a CRLF file the old text
 * is matched with either ending and the new text gets CRLF everywhere (no mixed endings).
 * Returns how many places matched (0 = not found) and the new text when it matched.
 */
export function applyEdit(text: string, oldText: string, newText: string, replaceAll: boolean): { count: number; next?: string } {
  const eol = lineEnding(text);
  const toEol = (s: string) => s.replace(/\r?\n/g, eol);
  const replacement = eol === "\r\n" || !text.includes("\r\n") ? toEol(newText) : newText;
  const tries = [...new Set([oldText, toEol(oldText), oldText.replace(/\r\n/g, "\n"), oldText.replace(/\r?\n/g, "\r\n")])];
  for (const o of tries) {
    const n = count(text, o);
    if (!n) continue;
    if (n > 1 && !replaceAll) return { count: n };
    return { count: n, next: replaceAll ? text.split(o).join(replacement) : text.replace(o, () => replacement) };
  }
  return { count: 0 };
}

/**
 * The command run_command gives the shell. Windows cmd.exe writes in the old OEM code page (850, 437, 720…),
 * which garbles French and Arabic when read as UTF-8: switch the console to UTF-8 first. `&` runs after it
 * whatever happens, and binds less tightly than && and ||, so the user's command keeps its meaning and exit code.
 */
export function shellCommand(command: string, platform: string, comspec: string | undefined): string {
  if (platform !== "win32") return command;
  const shell = (comspec || "cmd.exe").toLowerCase();
  if (!/(^|[\\/])cmd(\.exe)?$/.test(shell)) return command;
  return `chcp 65001 >nul 2>&1 & ${command}`;
}

// ---------- Linux user folders ----------

/**
 * The user's folders from ~/.config/user-dirs.dirs (Linux; names are translated: "Bureau", "Téléchargements"…).
 * Lines look like XDG_DESKTOP_DIR="$HOME/Bureau". Returns absolute paths; the home folder itself is left out.
 */
export function parseUserDirs(text: string, home: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*XDG_(DESKTOP|DOCUMENTS|DOWNLOAD|PICTURES|VIDEOS|MUSIC)_DIR\s*=\s*"([^"]*)"\s*$/);
    if (!m) continue;
    const h = home.replace(/\/+$/, "");
    let p = m[2]!.replace(/\\"/g, '"');
    if (p.startsWith("$HOME")) p = h + p.slice(5);
    else if (!p.startsWith("/")) continue; // only $HOME/… or absolute paths are allowed by the format
    p = p.replace(/\/+$/, "");
    // Only folders inside the user's home (a folder set to $HOME itself means "not used"); no "..".
    if (!p.startsWith(`${h}/`) || p.split("/").includes("..")) continue;
    out.push(p);
  }
  return out;
}

// ---------- theOovi failures ----------

/**
 * The errorCode for a failed theOovi call: the server's own code when it sent one (no_credits, daily_limit…),
 * "offline" when nothing answered, "signed_out" for 401, "busy" only for the passing statuses (429, 502, 503,
 * 504, 529). Any other status (a 400 from a request oovi built wrong, a 500) gets no code: it is a real failure,
 * shown as it is and counted in the run reports, which skip errors with a code.
 */
export function hostedCode(status: number, serverCode?: string): string | undefined {
  if (serverCode) return serverCode;
  if (status === 0) return "offline";
  if (status === 401) return "signed_out";
  if (status === 429 || status === 502 || status === 503 || status === 504 || status === 529) return "busy";
  return undefined;
}
