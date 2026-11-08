// Project folder: the one folder on the user's computer that bots in a chat may work in.
//
// Rules (enforced here and in tools.needsApproval):
// - Every path is resolved inside the folder; anything outside it (including via
//   "..", absolute paths or symlinks) is refused.
// - Reading, listing and searching never ask.
// - Creating and editing files ask, unless the user allowed edits in this folder.
// - Deleting (moved to oovi's trash, not erased) and running commands always ask.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolSpec } from "./llm";
import { dataDir } from "./settings";
import type { ToolCall, ToolResult, Workspace } from "./types";

export const FILE_SPECS: ToolSpec[] = [
  {
    name: "list_files",
    description: "List files and folders in the project folder (or a subfolder). Skips node_modules, .git, build output and similar.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Subfolder relative to the project folder; empty for the whole project" },
        depth: { type: "integer", minimum: 1, maximum: 5, description: "How many levels deep (default 2)" },
      },
    },
  },
  {
    name: "read_file",
    description: "Read a text file from the project folder. Lines are numbered for reference; the numbers are not part of the file. Long files come in parts: pass start_line to continue.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, start_line: { type: "integer", minimum: 1 } },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    description: "Find text in the project's files (case-insensitive). Returns file:line matches.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" }, path: { type: "string", description: "Optional subfolder to search in" } },
      required: ["query"],
    },
  },
  {
    name: "write_file",
    description: "Create a file, or replace a file's whole content. Folders are created as needed. For small changes to an existing file, use edit_file instead.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    description: "Replace exact text in a file. old_text must match the file exactly (copy it from read_file, without line numbers) and appear once, unless replace_all is true.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, old_text: { type: "string" }, new_text: { type: "string" }, replace_all: { type: "boolean" } },
      required: ["path", "old_text", "new_text"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file or folder. It is moved to oovi's trash, so the user can recover it. The user always approves this.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "run_command",
    description: "Run a shell command in the project folder, e.g. `npm install` or `npm test`. No keyboard input is possible, so use non-interactive flags. Returns the exit code and output. The user always approves this.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_seconds: { type: "integer", minimum: 5, maximum: 900, description: "Default 120" },
      },
      required: ["command"],
    },
  },
];

export const FILE_TOOLS: ReadonlySet<string> = new Set(FILE_SPECS.map((s) => s.name));
/** Asks unless the user allowed edits in this folder. */
export const EDIT_TOOLS: ReadonlySet<string> = new Set(["write_file", "edit_file"]);
/** Always asks. */
export const ALWAYS_ASK_TOOLS: ReadonlySet<string> = new Set(["delete_file", "run_command"]);

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".turbo", ".cache", "dist", "build", "out", "coverage", ".venv", "venv", "__pycache__", "target", ".idea", ".gradle", "Pods"]);
const MAX_LIST = 400;
const MAX_READ_BYTES = 5 * 1024 * 1024;
const READ_LINES = 400;
const READ_CHARS = 24_000;
const MAX_WRITE = 2 * 1024 * 1024;
const MAX_OUTPUT = 16_000;

// ---------- choosing a folder ----------

const isWin = process.platform === "win32";
const norm = (p: string) => (isWin ? p.toLowerCase() : p);
/** True when `child` is `parent` or inside it. */
function within(parent: string, child: string): boolean {
  const rel = path.relative(norm(parent), norm(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function systemDirs(): string[] {
  if (isWin) {
    const env = process.env;
    return [env.SystemRoot || "C:\\Windows", env.ProgramFiles || "C:\\Program Files", env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", env.ProgramData || "C:\\ProgramData"];
  }
  return ["/System", "/bin", "/sbin", "/usr", "/etc", "/var", "/private/etc", "/private/var", "/Library", "/Applications", "/dev", "/proc", "/boot", "/opt/homebrew"];
}

/** Check a folder the user picked. Returns its real path, or an error message. */
export function checkFolder(input: unknown): { path: string } | { error: string } {
  if (typeof input !== "string" || !input.trim()) return { error: "Choose a folder." };
  const raw = input.trim();
  if (!path.isAbsolute(raw)) return { error: "Use the folder's full path, for example D:\\Projects\\my-app or /Users/you/my-app." };
  let real: string;
  try {
    real = fs.realpathSync(path.resolve(raw));
    if (!fs.statSync(real).isDirectory()) return { error: "That's a file, not a folder." };
  } catch {
    return { error: "That folder doesn't exist." };
  }
  if (path.dirname(real) === real) return { error: "Choose a project folder, not a whole drive." };
  if (within(real, os.homedir())) return { error: "Choose a project folder, not your whole user folder. Make a folder for the project inside it." };
  for (const d of systemDirs()) if (within(d, real)) return { error: "That's a system folder. Choose one of your own project folders." };
  const data = process.env.OOVI_DATA;
  if (data && (within(path.resolve(data), real) || within(real, path.resolve(data)))) return { error: "That folder holds oovi's own data. Choose another one." };
  return { path: real };
}

/** Parse {path, autoEdit} from a request. null = remove the folder. */
export function validateWorkspace(input: unknown): Workspace | null | string {
  if (input === null) return null;
  if (!input || typeof input !== "object") return "Send {path} or null.";
  const o = input as Record<string, unknown>;
  const r = checkFolder(o.path);
  if ("error" in r) return r.error;
  return { path: r.path, autoEdit: o.autoEdit === true };
}

// ---------- paths inside the folder ----------

class FolderError extends Error {}

function rootOf(ws: Workspace | undefined): string {
  if (!ws) throw new FolderError("This chat has no project folder. The user can choose one with the folder button at the top of the chat.");
  try {
    return fs.realpathSync(ws.path);
  } catch {
    throw new FolderError(`The project folder ${ws.path} no longer exists. Ask the user to choose it again.`);
  }
}

/** Resolve a bot-supplied path inside the project folder, or throw. */
function resolveIn(root: string, p: unknown): { abs: string; rel: string } {
  const raw = typeof p === "string" ? p.trim().replace(/^["']|["']$/g, "") : "";
  const abs = path.resolve(root, raw || ".");
  if (!within(root, abs)) throw new FolderError(`"${raw}" is outside the project folder. Use paths relative to the project folder.`);
  // Symlinks: the closest part of the path that exists must also be inside.
  let probe = abs;
  while (!fs.existsSync(probe) && probe !== root) probe = path.dirname(probe);
  if (!within(root, fs.realpathSync(probe))) throw new FolderError(`"${raw}" points outside the project folder.`);
  const rel = path.relative(root, abs).split(path.sep).join("/") || ".";
  return { abs, rel };
}

function size(n: number): string {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.ceil(n / 1024)} KB` : `${n} B`;
}

function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8000).includes(0);
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s;
}

// ---------- approval text ----------

/** One-line summary and an optional preview for the approval card. */
export function describeFileCall(call: ToolCall, ws: Workspace | undefined): { summary: string; detail?: string } {
  const i = call.input;
  const p = String(i.path ?? "").trim() || ".";
  const folder = ws ? path.basename(ws.path) : "the project folder";
  switch (call.name) {
    case "write_file": {
      let exists = false;
      try {
        exists = fs.existsSync(resolveIn(rootOf(ws), p).abs);
      } catch {
        /* described anyway; running it reports the problem */
      }
      const content = String(i.content ?? "");
      return { summary: `${exists ? "Replace" : "Create"} ${p} in ${folder} (${size(Buffer.byteLength(content))})`, detail: clip(content, 4000) };
    }
    case "edit_file": {
      const minus = String(i.old_text ?? "").split("\n").map((l) => `- ${l}`).join("\n");
      const plus = String(i.new_text ?? "").split("\n").map((l) => `+ ${l}`).join("\n");
      return { summary: `Edit ${p} in ${folder}${i.replace_all === true ? " (every match)" : ""}`, detail: clip(`${minus}\n${plus}`, 4000) };
    }
    case "delete_file":
      return { summary: `Delete ${p} from ${folder} (moved to oovi's trash)` };
    case "run_command":
      return { summary: `Run a command in ${folder}`, detail: String(i.command ?? "") };
    default:
      return { summary: call.name };
  }
}

// ---------- running the tools ----------

const ok = (call: ToolCall, content: string): ToolResult => ({ id: call.id, name: call.name, content });
const bad = (call: ToolCall, content: string): ToolResult => ({ id: call.id, name: call.name, content, isError: true });

export async function runFileTool(call: ToolCall, ws: Workspace | undefined): Promise<ToolResult> {
  try {
    const root = rootOf(ws);
    const i = call.input;
    switch (call.name) {
      case "list_files":
        return ok(call, listFiles(root, i.path, Math.min(5, Math.max(1, Number(i.depth) || 2))));
      case "read_file":
        return readFile(call, root, i.path, Math.max(1, Number(i.start_line) || 1));
      case "search_files":
        return searchFiles(call, root, String(i.query ?? ""), i.path);
      case "write_file": {
        const { abs, rel } = resolveIn(root, i.path);
        guardWrite(rel);
        const content = typeof i.content === "string" ? i.content : "";
        if (Buffer.byteLength(content) > MAX_WRITE) return bad(call, `That's more than ${MAX_WRITE / 1048576} MB; split it into smaller files.`);
        const existed = fs.existsSync(abs);
        if (existed && fs.statSync(abs).isDirectory()) return bad(call, `${rel} is a folder.`);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
        return ok(call, `${existed ? "Replaced" : "Created"} ${rel} (${content.split("\n").length} lines).`);
      }
      case "edit_file":
        return editFile(call, root);
      case "delete_file": {
        const { abs, rel } = resolveIn(root, i.path);
        if (rel === ".") return bad(call, "You can't delete the project folder itself.");
        guardWrite(rel);
        if (!fs.existsSync(abs)) return bad(call, `${rel} doesn't exist.`);
        const dest = path.join(dataDir(), "trash", new Date().toISOString().replace(/[:.]/g, "-"), path.basename(root), rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        try {
          fs.renameSync(abs, dest);
        } catch {
          fs.cpSync(abs, dest, { recursive: true });
          fs.rmSync(abs, { recursive: true, force: true });
        }
        return ok(call, `Deleted ${rel}. It's in oovi's trash at ${dest} if the user wants it back.`);
      }
      case "run_command":
        return await runCommand(call, root, String(i.command ?? "").trim(), Math.min(900, Math.max(5, Number(i.timeout_seconds) || 120)));
      default:
        return bad(call, `Unknown tool: ${call.name}`);
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (e instanceof FolderError) return bad(call, err.message);
    if (err.code === "ENOENT") return bad(call, "That file or folder doesn't exist. Use list_files to see what's there.");
    if (err.code === "EACCES" || err.code === "EPERM") return bad(call, "The computer didn't allow access to that file.");
    if (err.code === "EBUSY") return bad(call, "That file is in use by another program.");
    return bad(call, err.message || String(e));
  }
}

function guardWrite(rel: string) {
  if (rel === ".git" || rel.startsWith(".git/")) throw new FolderError("Bots don't change files inside .git. Use git commands with run_command instead.");
}

function listFiles(root: string, sub: unknown, depth: number): string {
  const { abs, rel } = resolveIn(root, sub);
  if (!fs.statSync(abs).isDirectory()) return `${rel} is a file (${size(fs.statSync(abs).size)}).`;
  const lines: string[] = [];
  let truncated = false;
  const walk = (dir: string, level: number) => {
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    items.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const it of items) {
      if (lines.length >= MAX_LIST) {
        truncated = true;
        return;
      }
      const pad = "  ".repeat(level);
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (SKIP_DIRS.has(it.name)) {
          lines.push(`${pad}${it.name}/ (skipped)`);
          continue;
        }
        lines.push(`${pad}${it.name}/`);
        if (level + 1 < depth) walk(full, level + 1);
      } else {
        let s = "";
        try {
          s = ` (${size(fs.statSync(full).size)})`;
        } catch {
          /* unreadable */
        }
        lines.push(`${pad}${it.name}${s}`);
      }
    }
  };
  walk(abs, 0);
  const head = `Project folder: ${root}\n${rel === "." ? "" : `Inside ${rel}/:\n`}`;
  if (!lines.length) return `${head}(empty)`;
  return `${head}${lines.join("\n")}${truncated ? "\n… more not shown; list a subfolder to see it." : ""}`;
}

function readFile(call: ToolCall, root: string, p: unknown, start: number): ToolResult {
  const { abs, rel } = resolveIn(root, p);
  const st = fs.statSync(abs);
  if (st.isDirectory()) return bad(call, `${rel} is a folder. Use list_files.`);
  if (st.size > MAX_READ_BYTES) return bad(call, `${rel} is ${size(st.size)}, too big to read. Use search_files to find the part you need.`);
  const buf = fs.readFileSync(abs);
  if (isBinary(buf)) return bad(call, `${rel} isn't a text file (${size(st.size)}).`);
  const all = buf.toString("utf8").split(/\r?\n/);
  const out: string[] = [];
  let chars = 0;
  let n = start;
  for (; n <= all.length && out.length < READ_LINES; n++) {
    const line = `${n}\t${all[n - 1]}`;
    if (chars + line.length > READ_CHARS && out.length) break;
    out.push(line);
    chars += line.length + 1;
  }
  const more = n <= all.length ? `\n… ${all.length - n + 1} more lines. Continue with start_line=${n}.` : "";
  return ok(call, `${rel} (${all.length} lines):\n${out.join("\n")}${more}`);
}

function searchFiles(call: ToolCall, root: string, query: string, sub: unknown): ToolResult {
  const q = query.trim().toLowerCase();
  if (!q) return bad(call, "query is required");
  const { abs } = resolveIn(root, sub);
  const hits: string[] = [];
  let files = 0;
  const walk = (dir: string) => {
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const it of items) {
      if (hits.length >= 60 || files >= 3000) return;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (!SKIP_DIRS.has(it.name)) walk(full);
        continue;
      }
      files++;
      let buf: Buffer;
      try {
        if (fs.statSync(full).size > 1048576) continue;
        buf = fs.readFileSync(full);
      } catch {
        continue;
      }
      if (isBinary(buf)) continue;
      const lines = buf.toString("utf8").split(/\r?\n/);
      const rel = path.relative(root, full).split(path.sep).join("/");
      for (let n = 0; n < lines.length && hits.length < 60; n++) {
        if (lines[n]?.toLowerCase().includes(q)) hits.push(`${rel}:${n + 1}: ${(lines[n] ?? "").trim().slice(0, 200)}`);
      }
    }
  };
  if (fs.statSync(abs).isDirectory()) walk(abs);
  if (!hits.length) return ok(call, `No matches for "${query}".`);
  return ok(call, `${hits.length >= 60 ? "First 60 matches" : `${hits.length} matches`} for "${query}":\n${hits.join("\n")}`);
}

function editFile(call: ToolCall, root: string): ToolResult {
  const i = call.input;
  const { abs, rel } = resolveIn(root, i.path);
  guardWrite(rel);
  let oldText = typeof i.old_text === "string" ? i.old_text : "";
  let newText = typeof i.new_text === "string" ? i.new_text : "";
  if (!oldText) return bad(call, "old_text is required. To create a file, use write_file.");
  const text = fs.readFileSync(abs, "utf8");
  let count = text.split(oldText).length - 1;
  // Windows line endings: bots usually send \n.
  if (count === 0 && text.includes("\r\n") && !oldText.includes("\r\n")) {
    oldText = oldText.replace(/\n/g, "\r\n");
    newText = newText.replace(/\r?\n/g, "\r\n");
    count = text.split(oldText).length - 1;
  }
  if (count === 0) return bad(call, `old_text wasn't found in ${rel}. Read the file again and copy the text exactly (without line numbers).`);
  if (count > 1 && i.replace_all !== true) return bad(call, `old_text appears ${count} times in ${rel}. Include more surrounding lines so it's unique, or set replace_all.`);
  const next = i.replace_all === true ? text.split(oldText).join(newText) : text.replace(oldText, () => newText);
  fs.writeFileSync(abs, next);
  return ok(call, `Edited ${rel}${count > 1 ? ` (${count} places)` : ""}.`);
}

function commandEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "1", FORCE_COLOR: "0", NO_COLOR: "1", npm_config_yes: "true" };
  // Apps opened from the Dock/Finder get a minimal PATH; add the usual tool folders.
  if (process.platform === "darwin") {
    const extra = ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local/bin")];
    env.PATH = [...new Set([...(env.PATH ?? "").split(":"), ...extra].filter(Boolean))].join(":");
  }
  // Don't hand the app's own Electron/Next settings to the user's tools.
  for (const k of Object.keys(env)) if (k.startsWith("OOVI_") || k.startsWith("__NEXT") || k === "ELECTRON_RUN_AS_NODE" || k === "NODE_OPTIONS") delete env[k];
  delete (env as Record<string, string | undefined>).NODE_ENV;
  return env;
}

function runCommand(call: ToolCall, root: string, command: string, timeoutS: number): Promise<ToolResult> {
  if (!command) return Promise.resolve(bad(call, "command is required"));
  return new Promise((resolve) => {
    let out = "";
    let timedOut = false;
    let done = false;
    const started = Date.now();
    const child = spawn(command, { cwd: root, shell: true, env: commandEnv(), windowsHide: true, detached: !isWin, stdio: ["ignore", "pipe", "pipe"] });
    const add = (d: Buffer) => {
      out += d.toString("utf8");
      if (out.length > MAX_OUTPUT * 4) out = out.slice(-MAX_OUTPUT * 2);
    };
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (isWin && child.pid) spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
        else if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutS * 1000);
    const finish = (code: number | null, err?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      // eslint-disable-next-line no-control-regex
      let text = out.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").trim();
      if (text.length > MAX_OUTPUT) text = `… (earlier output cut)\n${text.slice(-MAX_OUTPUT)}`;
      const head = err
        ? `Couldn't start the command: ${err.message}`
        : timedOut
          ? `Stopped after ${timeoutS}s (time limit). Don't start servers or watchers unless the user asked; they get stopped at the limit.`
          : `Exit code ${code ?? "?"} after ${secs}s.`;
      resolve({ id: call.id, name: call.name, content: `$ ${command}\n${head}\n${text || "(no output)"}`, isError: !!err || timedOut || code !== 0 });
    };
    child.on("error", (e) => finish(null, e));
    child.on("close", (code) => finish(code));
  });
}
