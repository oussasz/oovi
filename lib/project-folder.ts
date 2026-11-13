// use_project_folder: a bot asks to work in a folder the user named ("make the project in
// D:\Projects\shop"). The user sees a card and decides; on yes, the folder becomes this chat's
// project folder (the same as choosing it with the folder button) and the bot's turn restarts
// with the file tools (write_file, edit_file…). Without this, code and configuration files had
// nowhere to go but Downloads/oovi.

import fs from "node:fs";
import path from "node:path";
import type { ToolSpec } from "./llm";
import { homeDir } from "./home";
import type { Tr } from "./i18n-server";
import type { ApprovalItem, Chat, ToolCall, ToolResult } from "./types";
import { checkFolder, systemDirs, within } from "./workspace";

export const USE_FOLDER_SPEC: ToolSpec = {
  name: "use_project_folder",
  description:
    "Ask the user to let this chat work in a folder on their computer: a project they name ('in D:\\Projects\\shop', 'in my Documents/site folder'), or a new folder for a project you'll create. The user sees a card and decides. Once they agree, it is this chat's project folder: you get list_files, read_file, write_file, edit_file and run_command there (every file you write still shows the user what changes, unless they allowed edits without asking). A folder that doesn't exist yet is created. Use it whenever the work is files of a project (code, configuration such as .py, .toml, .env.example, .gitignore, a website): never put such files in Downloads/oovi instead.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "The folder's full path, e.g. 'D:\\Projects\\shop', '/home/sam/projects/api', '~/Documents/site'" },
      why: { type: "string", description: "One sentence the user sees, e.g. 'To create the Flask app files you asked for.'" },
    },
    required: ["path", "why"],
  },
};

export type FolderTarget = { path: string; create: boolean; why: string };

/** The folder the bot asks for, checked by the same rules as the folder button. A string is the reason it can't be used. */
export function folderTarget(input: Record<string, unknown>, current?: { path: string }): FolderTarget | string {
  const why = typeof input.why === "string" ? input.why.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  let raw = typeof input.path === "string" ? input.path.trim().replace(/^["']|["']$/g, "") : "";
  if (!raw) return "path is required: the folder's full path.";
  if (/^~([\\/]|$)/.test(raw)) raw = path.join(homeDir(), raw.slice(1));
  if (!path.isAbsolute(raw)) return `"${raw}" isn't a full path. Ask the user where the folder is (for example D:\\Projects\\shop or /home/you/projects/shop).`;
  const want = path.resolve(raw);
  let target: string;
  let create = false;
  if (fs.existsSync(want)) {
    const r = checkFolder(want);
    if ("error" in r) return r.error;
    target = r.path;
  } else {
    // A new folder: what exists of its path must be a real place, and the folder itself follows the same rules.
    let base = want;
    while (!fs.existsSync(base) && path.dirname(base) !== base) base = path.dirname(base);
    let real: string;
    try {
      real = fs.realpathSync(base);
      if (!fs.statSync(real).isDirectory()) return `${base} is a file, not a folder.`;
    } catch {
      return `${want} can't be created: no part of that path exists on this computer.`;
    }
    target = path.join(real, path.relative(base, want));
    if (path.relative(real, target).split(path.sep).length > 3) return `${want} is too many new folders deep. Ask the user for an existing folder to start from.`;
    if (within(target, homeDir())) return "Choose a project folder, not your whole user folder. Make a folder for the project inside it.";
    for (const d of systemDirs()) if (within(d, target)) return "That's a system folder. Choose one of your own project folders.";
    const data = process.env.OOVI_DATA;
    if (data && (within(path.resolve(data), target) || within(target, path.resolve(data)))) return "That folder holds oovi's own data. Choose another one.";
    create = true;
  }
  if (current && path.resolve(current.path) === target) return `${target} is already this chat's project folder: use write_file, edit_file and the other file tools there.`;
  return { path: target, create, why };
}

export function useFolderItem(call: ToolCall, chat: Chat, botName: string, tr: Tr): ApprovalItem {
  const t = folderTarget(call.input, chat.workspace);
  if (typeof t === "string") return { call, summary: t };
  return {
    call,
    summary: tr("ok.useFolder", { bot: botName, path: t.path }),
    detail: [t.why, t.create ? tr("ok.useFolderNew") : "", chat.workspace ? tr("ok.useFolderInstead", { path: chat.workspace.path }) : "", tr("folder.intro")].filter(Boolean).join("\n"),
  };
}

/** After the user said yes. Checked again: the disk may have changed meanwhile. */
export function runUseFolder(call: ToolCall, chat: Chat): ToolResult {
  const bad = (content: string): ToolResult => ({ id: call.id, name: call.name, content, isError: true });
  const t = folderTarget(call.input, chat.workspace);
  if (typeof t === "string") return bad(t);
  try {
    if (t.create) fs.mkdirSync(t.path, { recursive: true });
  } catch (e) {
    return bad(`Couldn't create ${t.path}: ${(e as Error).message}`);
  }
  const r = checkFolder(t.path);
  if ("error" in r) return bad(r.error);
  chat.workspace = { path: r.path, autoEdit: false };
  return {
    id: call.id,
    name: call.name,
    content: `${t.create ? "Created the folder and made it" : "Made"} ${r.path} this chat's project folder. From your next step you have the file tools there (paths relative to it): carry on with the task.`,
  };
}
