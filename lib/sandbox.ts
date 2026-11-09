// Cloud computer: each chat gets its own private Linux virtual machine (an E2B
// Firecracker microVM, the same kind Manus runs its agents in) on the user's
// own E2B account. Bots run code, install tools, analyze data and build things
// there, without touching the user's computer and without needing a powerful
// PC. Files they make come back with vm_download.
//
// One VM per chat, created on first use and shut down by E2B after 20 minutes
// without activity (each use pushes that back).

import path from "node:path";
import { CommandExitError, Sandbox } from "e2b";
import type { ToolSpec } from "./llm";
import { saveOutput } from "./files";
import type { Settings } from "./settings";
import type { ToolCall, ToolResult, Workspace } from "./types";

const IDLE_MS = 20 * 60_000;
const HOME = "/home/user";
const MAX_OUT = 8_000;
const MAX_READ = 100_000;
const MAX_DOWNLOAD = 100 * 1024 * 1024;

export const VM_SPECS: ToolSpec[] = [
  {
    name: "vm_run",
    description:
      "Run a shell command on your own private cloud computer (Ubuntu Linux with Python 3, pip, Node.js, npm, git and internet access). Use it to run code, analyze data, test programs, install packages (pip install, npm i, sudo apt-get install -y), convert files, scrape, or build projects. The working directory is /home/user. Returns exit code, stdout and stderr.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Bash command, e.g. 'python3 analysis.py' or 'pip install pandas && python3 -c \"import pandas; print(pandas.__version__)\"'" },
        timeout_seconds: { type: "number", description: "Max run time, default 120, up to 600. Start long-running servers with '&' or nohup instead." },
        cwd: { type: "string", description: "Working directory (default /home/user)." },
      },
      required: ["command"],
    },
  },
  {
    name: "vm_write_file",
    description: "Write a text file on your cloud computer (creates folders as needed). Paths are relative to /home/user unless absolute.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
  },
  {
    name: "vm_read_file",
    description: "Read a text file from your cloud computer.",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "vm_download",
    description: "Give the user a file you made on the cloud computer: it is copied to their project folder (if one is linked) or their Downloads, and shown in the chat with an Open button. Use this for every result file (charts, reports, spreadsheets, zips, code).",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "File on the cloud computer." }, filename: { type: "string", description: "Name to save it as (default: same name)." } },
      required: ["path"],
    },
  },
  {
    name: "vm_public_url",
    description: "Get a public https link to a web server running on your cloud computer (start it first with vm_run, e.g. 'nohup python3 -m http.server 8000 &'). Share the link so the user can try the site or app in their browser.",
    parameters: { type: "object", properties: { port: { type: "number" } }, required: ["port"] },
  },
];

export const VM_TOOLS: ReadonlySet<string> = new Set(VM_SPECS.map((s) => s.name));

export const hasVm = (s: Settings) => !!s.sandbox?.e2bKey;

// Survive dev-server reloads: keep the live VMs on globalThis.
const g = globalThis as unknown as { __ooviVms?: Map<string, Promise<Sandbox>> };
const vms = (g.__ooviVms ??= new Map<string, Promise<Sandbox>>());

/** The chat's VM, started on first use. `fresh` is true when an old one had shut down. */
async function vmFor(chatId: string, apiKey: string): Promise<{ sbx: Sandbox; fresh: boolean }> {
  const cur = vms.get(chatId);
  if (cur) {
    try {
      const sbx = await cur;
      await sbx.setTimeout(IDLE_MS); // still alive: keep it a while longer
      return { sbx, fresh: false };
    } catch {
      vms.delete(chatId); // it timed out or failed to start
    }
  }
  const p = Sandbox.create({ apiKey, timeoutMs: IDLE_MS, metadata: { app: "oovi" } });
  vms.set(chatId, p);
  try {
    return { sbx: await p, fresh: !!cur };
  } catch (e) {
    vms.delete(chatId);
    throw e;
  }
}

/** Shut a chat's VM down now (when the chat is cleared or deleted). */
export async function stopVm(chatId: string): Promise<void> {
  const cur = vms.get(chatId);
  vms.delete(chatId);
  if (cur) await cur.then((s) => s.kill()).catch(() => {});
}

const abs = (p: string) => (p.startsWith("/") ? p : `${HOME}/${p.replace(/^\.\/+/, "")}`);

/** Keep the start and the end of long output. */
function clip(s: string, max = MAX_OUT): string {
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.3);
  return `${s.slice(0, head)}\n…[${s.length - max} characters cut]…\n${s.slice(-(max - head))}`;
}

const fail = (call: ToolCall, content: string): ToolResult => ({ id: call.id, name: call.name, content, isError: true });

function explain(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e);
  if (/401|unauthori[sz]ed|invalid api key|api key/i.test(msg)) return "The cloud computer key (E2B) was rejected. The user can check it in Settings > Cloud computer.";
  if (/402|payment|credit|quota/i.test(msg)) return `The E2B account is out of credit or over its limit: ${msg.slice(0, 200)}`;
  return `Cloud computer error: ${msg.slice(0, 300)}`;
}

export async function runVmTool(call: ToolCall, s: Settings, chatId: string, ws?: Workspace): Promise<ToolResult> {
  const key = s.sandbox?.e2bKey;
  if (!key) return fail(call, "No cloud computer is set up. The user can add an E2B key in Settings > Cloud computer.");
  const input = call.input;
  try {
    const { sbx, fresh } = await vmFor(chatId, key);
    const note = fresh ? "(The previous cloud computer had shut down after being idle, so this is a fresh one: earlier files are gone.)\n" : "";

    if (call.name === "vm_run") {
      const command = String(input.command ?? "").trim();
      if (!command) return fail(call, "command is required.");
      const secs = Math.min(600, Math.max(5, Number(input.timeout_seconds) || 120));
      let r: { exitCode: number; stdout: string; stderr: string };
      try {
        r = await sbx.commands.run(command, { timeoutMs: secs * 1000, cwd: typeof input.cwd === "string" && input.cwd ? abs(input.cwd) : HOME });
      } catch (e) {
        if (e instanceof CommandExitError) r = { exitCode: e.exitCode, stdout: e.stdout, stderr: e.stderr };
        else if (/timeout|timed out|deadline/i.test((e as Error).message)) return fail(call, `${note}The command was still running after ${secs} seconds and was stopped. Run long jobs in the background (nohup … &) and check on them.`);
        else throw e;
      }
      const parts = [`${note}exit code ${r.exitCode}`];
      if (r.stdout.trim()) parts.push(`--- stdout ---\n${clip(r.stdout)}`);
      if (r.stderr.trim()) parts.push(`--- stderr ---\n${clip(r.stderr, 4000)}`);
      if (!r.stdout.trim() && !r.stderr.trim()) parts.push("(no output)");
      return { id: call.id, name: call.name, content: parts.join("\n"), isError: r.exitCode !== 0 };
    }

    if (call.name === "vm_write_file") {
      const rel = String(input.path ?? "").trim();
      if (!rel) return fail(call, "path is required.");
      const content = typeof input.content === "string" ? input.content : "";
      await sbx.files.write(abs(rel), content);
      return { id: call.id, name: call.name, content: `${note}Wrote ${abs(rel)} (${content.length} characters).` };
    }

    if (call.name === "vm_read_file") {
      const text = await sbx.files.read(abs(String(input.path ?? "")));
      return { id: call.id, name: call.name, content: `${note}${text.length > MAX_READ ? `${text.slice(0, MAX_READ)}\n…[cut, ${text.length} characters in total]` : text}` };
    }

    if (call.name === "vm_download") {
      const p = abs(String(input.path ?? ""));
      const bytes = await sbx.files.read(p, { format: "bytes" });
      if (bytes.byteLength > MAX_DOWNLOAD) return fail(call, `That file is ${(bytes.byteLength / 1048576).toFixed(0)} MB; the limit is 100 MB. Compress or split it first.`);
      const name = typeof input.filename === "string" && input.filename.trim() ? input.filename.trim() : path.posix.basename(p);
      return saveOutput(call, name, ws, Buffer.from(bytes), "file from the cloud computer");
    }

    if (call.name === "vm_public_url") {
      const port = Math.round(Number(input.port));
      if (!(port > 0 && port < 65536)) return fail(call, "port must be a number between 1 and 65535.");
      return { id: call.id, name: call.name, content: `${note}https://${sbx.getHost(port)} (works while the server runs and the cloud computer is on; it shuts down after 20 idle minutes).` };
    }
    return fail(call, `Unknown tool ${call.name}.`);
  } catch (e) {
    return fail(call, explain(e));
  }
}

/** Short status text for the chat. */
export function describeVmCall(call: ToolCall): string {
  const i = call.input;
  if (call.name === "vm_run") return `Running on the cloud computer: ${String(i.command ?? "").slice(0, 80)}`;
  if (call.name === "vm_write_file") return `Writing ${String(i.path ?? "")} on the cloud computer`;
  if (call.name === "vm_read_file") return `Reading ${String(i.path ?? "")} on the cloud computer`;
  if (call.name === "vm_download") return `Saving ${String(i.filename ?? i.path ?? "")} to your computer`;
  if (call.name === "vm_public_url") return "Getting a public link";
  return "Using the cloud computer";
}
