// Feedback from the desktop app: problems and ideas, shown in the console (/admin/feedback).
import { apiError, getRequestSession, noContent, rateLimit, readJson } from "@/lib/api";
import { pool } from "@/lib/db";
import { parsePlatform, parseVersion } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

const KINDS = new Set(["problem", "improvement", "other"]);

export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in to send feedback.", 401);
  if (!rateLimit(`feedback:${session.user.id}`, 10, 10 * 60_000)) return apiError("You've sent a lot of feedback in a short time. Please wait a few minutes.", 429);
  const body = await readJson(req, 32 * 1024);
  if (!body) return apiError("Invalid request.", 400);
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
