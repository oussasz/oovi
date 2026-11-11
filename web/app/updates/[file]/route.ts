// Update feed for the desktop app (electron-updater "generic" provider, url https://oovi.conuron.com/updates).
// latest.yml / latest-mac.yml / latest-linux.yml are served from here; the installers and .blockmap files are a
// redirect to a short-lived download link. The app never talks to GitHub itself.
import { UPDATE_FILE, updateFileUrl, updateManifest } from "@/lib/releases";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!UPDATE_FILE.test(file)) return new Response("Not found", { status: 404 });
  if (file === "latest.yml" || file === "latest-mac.yml" || file === "latest-linux.yml") {
    const text = await updateManifest(file);
    if (!text) return new Response("Update information isn't available right now.", { status: 503, headers: { "Retry-After": "300" } });
    return new Response(text, { headers: { "Content-Type": "text/yaml; charset=utf-8", "Cache-Control": "public, max-age=60, s-maxage=300" } });
  }
  const url = await updateFileUrl(file);
  if (!url) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
}
