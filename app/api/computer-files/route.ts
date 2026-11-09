import { checkAllowedFolder, usualFolders } from "@/lib/computer";
import { guard } from "@/lib/guard";
import { loadSettings, setComputerFiles, type ComputerFilesMode } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const state = () => ({ ...loadSettings().computerFiles, usual: usualFolders() });

/** "Files on this computer" (Settings > Safety): the mode, the allowed folders and the usual folders bots search. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(state());
}

/** {mode} | {addFolder} | {removeFolder} */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { mode?: unknown; addFolder?: unknown; removeFolder?: unknown } | null;
  const cur = loadSettings().computerFiles;
  if (body?.mode === "off" || body?.mode === "ask" || body?.mode === "folders") {
    setComputerFiles({ ...cur, mode: body.mode as ComputerFilesMode });
  } else if (typeof body?.addFolder === "string") {
    const r = checkAllowedFolder(body.addFolder);
    if ("error" in r) return Response.json({ error: r.error }, { status: 400 });
    if (!cur.folders.includes(r.path)) setComputerFiles({ mode: "folders", folders: [...cur.folders, r.path] });
  } else if (typeof body?.removeFolder === "string") {
    setComputerFiles({ ...cur, folders: cur.folders.filter((f) => f !== body.removeFolder) });
  } else {
    return Response.json({ error: "Send {mode}, {addFolder} or {removeFolder}." }, { status: 400 });
  }
  return Response.json(state());
}
