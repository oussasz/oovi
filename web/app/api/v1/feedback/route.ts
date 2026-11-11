// Feedback from the desktop app: problems and ideas, shown in the console (/admin/feedback).
import { apiError, getRequestSession, noContent, rateLimit, readJson } from "@/lib/api";
import { pool } from "@/lib/db";
import { parsePlatform, parseVersion } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

const KINDS = new Set(["problem", "improvement", "other"]);

export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in to send feedback.", 401);
  const body = await readJson(req, 32 * 1024);
  if (!body) return apiError("Invalid request.", 400);
  // A note from the app's bots about one of oovi's own tools (lib/tool-notes.ts in the app): short,
  // already cleaned of personal details there, stored once per user, shown under "From bots" in the console.
  if (body.source === "bot") {
    if (!rateLimit(`toolnote:${session.user.id}`, 20, 60 * 60_000)) return noContent();
    const note = typeof body.message === "string" ? body.message.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    if (note.length < 15) return apiError("Too short.", 400);
    const seen = await pool.query("SELECT 1 FROM feedback WHERE user_id = $1 AND source = 'bot' AND message = $2 AND created_at > now() - interval '30 days' LIMIT 1", [session.user.id, note]);
    if (!seen.rowCount) {
      await pool.query("INSERT INTO feedback (user_id, kind, message, source, app_version, platform) VALUES ($1, 'problem', $2, 'bot', $3, $4)", [
        session.user.id,
        note,
        parseVersion(req.headers.get("x-oovi-version")),
        parsePlatform(req.headers.get("x-oovi-platform")),
      ]);
    }
    return noContent();
  }
  if (!rateLimit(`feedback:${session.user.id}`, 10, 10 * 60_000)) return apiError("You've sent a lot of feedback in a short time. Please wait a few minutes.", 429);
  const kind = typeof body.kind === "string" && KINDS.has(body.kind) ? body.kind : null;
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!kind) return apiError("Pick a type: problem, improvement or other.", 400);
  if (message.length < 5) return apiError("Please write a few words.", 400);
  if (message.length > 5000) return apiError("Please keep it under 5,000 characters.", 400);
  await pool.query("INSERT INTO feedback (user_id, kind, message, source, app_version, platform) VALUES ($1, $2, $3, 'app', $4, $5)", [
    session.user.id,
    kind,
    message,
    parseVersion(req.headers.get("x-oovi-version")),
    parsePlatform(req.headers.get("x-oovi-platform")),
  ]);
  return noContent();
}
