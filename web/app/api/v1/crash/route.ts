import { apiError, clientIp, getRequestSession, noContent, rateLimit, readJson } from "@/lib/api";
import { pool } from "@/lib/db";
import { notify } from "@/lib/notify";
import { later } from "@/lib/user-signals";

export const dynamic = "force-dynamic";

function cap(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  let s: string | undefined;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return null;
  }
  if (typeof s !== "string") return null;
  return s.length > max ? s.slice(0, max) : s;
}

export async function POST(req: Request) {
  if (!rateLimit(`crash:${clientIp(req)}`, 30)) {
    return apiError("Too many crash reports. Please slow down.", 429);
  }
  const body = await readJson(req, 64 * 1024);
  if (!body) return apiError("Invalid JSON body (or body too large).", 400);

  const message = cap(body.message, 2 * 1024);
  if (!message) return apiError("message is required.", 400);
  const appVersion = cap(body.appVersion, 64) ?? "unknown";
  const platform = cap(body.platform, 64) ?? "unknown";
  const stack = cap(body.stack, 16 * 1024);
  const context = cap(body.context, 4 * 1024);

  const session = req.headers.get("authorization") ? await getRequestSession(req) : null;

  try {
    await pool.query(
      `INSERT INTO crash_reports (user_id, app_version, platform, message, stack, context)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [session?.user.id ?? null, appVersion, platform, message, stack, context],
    );
  } catch (err) {
    console.error("crash report insert failed", err);
    return apiError("Could not store the crash report.", 500);
  }
  later(() =>
    notify({
      event: "crash",
      title: `Crash in the app (${appVersion})`,
      lead: "The desktop app reported a crash.",
      rows: [["App version", appVersion], ["System", platform]],
      quote: message,
      button: { label: "Open Crashes", path: "/admin/crashes" },
    }),
  );
  return noContent();
}
