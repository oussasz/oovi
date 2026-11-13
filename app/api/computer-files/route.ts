import { checkAllowedFolder, usualFolders } from "@/lib/computer";
import { guard } from "@/lib/guard";
import { defaultDownloadsDir, downloadsDir } from "@/lib/browser";
import { chosenSaveFolder, loadSettings, setComputerFiles, setSaveFolder, type ComputerFilesMode } from "@/lib/settings";
import { checkFolder } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** saveFolder: where the files bots make go now; custom: the user chose it (else it's the default). */
const state = () => ({ ...loadSettings().computerFiles, usual: usualFolders(), saveFolder: downloadsDir(), saveDefault: defaultDownloadsDir(), custom: !!chosenSaveFolder() });

/** "Files on this computer" (Settings > Safety): the mode, the allowed folders and the usual folders bots search. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(state());
}

/** {mode} | {addFolder} | {removeFolder} | {saveFolder: path | null} */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { mode?: unknown; addFolder?: unknown; removeFolder?: unknown; saveFolder?: unknown } | null;
  const cur = loadSettings().computerFiles;
  if (body?.mode === "off" || body?.mode === "ask" || body?.mode === "folders") {
    setComputerFiles({ ...cur, mode: body.mode as ComputerFilesMode });
  } else if (typeof body?.addFolder === "string") {
    const r = checkAllowedFolder(body.addFolder);
    if ("error" in r) return Response.json({ error: r.error }, { status: 400 });
    if (!cur.folders.includes(r.path)) setComputerFiles({ mode: "folders", folders: [...cur.folders, r.path] });
  } else if (body && "saveFolder" in body && (body.saveFolder === null || typeof body.saveFolder === "string")) {
    if (body.saveFolder === null) setSaveFolder(null);
    else {
      const r = checkFolder(body.saveFolder);
      if ("error" in r) return Response.json({ error: r.error }, { status: 400 });
      setSaveFolder(r.path);
    }
  } else if (typeof body?.removeFolder === "string") {
    setComputerFiles({ ...cur, folders: cur.folders.filter((f) => f !== body.removeFolder) });
  } else {
    return Response.json({ error: "Send {mode}, {addFolder}, {removeFolder} or {saveFolder}." }, { status: 400 });
  }
  return Response.json(state());
}
