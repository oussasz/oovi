// Feedback from the desktop app: problems and ideas, shown in the console (/admin/feedback).
import { apiError, getRequestSession, noContent, rateLimit, readJson } from "@/lib/api";
import { pool } from "@/lib/db";
import { parsePlatform, parseVersion } from "@/lib/telemetry";
import { notify } from "@/lib/notify";
import { later } from "@/lib/user-signals";
import { PROBLEM_TAGS, PROBLEM_TAG_LABELS, saveProblem, type ProblemTag } from "@/lib/problems";

export const dynamic = "force-dynamic";

const KINDS = new Set(["problem", "improvement", "other"]);

export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in to send feedback.", 401);
  const body = await readJson(req, 32 * 1024);
  if (!body) return apiError("Invalid request.", 400);
  // A problem report from the app (lib/run-report.ts and lib/tool-notes.ts there): a tool error, a task that
  // stopped, or what a bot couldn't do. Short, already cleaned of personal details there, stored once per
  // user and app version, grouped on Admin > Problems.
  if (body.source === "bot") {
    if (!rateLimit(`toolnote:${session.user.id}`, 20, 60 * 60_000)) return noContent();
    const note = typeof body.message === "string" ? body.message.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    if (note.length < 15) return apiError("Too short.", 400);
    const tag = PROBLEM_TAGS.includes(body.tag as ProblemTag) ? (body.tag as ProblemTag) : "tool";
    const word = (v: unknown, max: number) => (typeof v === "string" && /^[\w.:-]{1,100}$/.test(v.trim()) ? v.trim().slice(0, max) : null);
    const version = parseVersion(req.headers.get("x-oovi-version"));
    const platform = parsePlatform(req.headers.get("x-oovi-platform"));
    const fresh = await saveProblem({ userId: session.user.id, message: note, tag, tool: word(body.tool, 60), site: word(body.site, 100), version, platform });
    // One email per problem: the first time anyone reports it, and the first time it comes back after a fix.
    if (fresh)
      later(() =>
        notify({
          event: "problem",
          title: fresh === "new" ? `New problem: ${PROBLEM_TAG_LABELS[tag]}` : `A fixed problem came back (${PROBLEM_TAG_LABELS[tag]})`,
          lead: fresh === "new" ? "The desktop app reported something it couldn't do for a customer. Same reports from others are counted on the Problems page, without more emails." : "This problem was marked fixed, and the app reported it again from the fixed version or a newer one.",
          rows: [["App version", version ?? "–"], ["Platform", platform ?? "–"]],
          quote: note,
          button: { label: "Open Problems", path: "/admin/problems" },
        }),
      );
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
  const from = session.user.email;
  const ver = parseVersion(req.headers.get("x-oovi-version")) ?? "–";
  later(() =>
    notify({
      event: "feedback",
      title: `New feedback (${kind}) from ${from}`,
      lead: "Someone sent feedback from the desktop app.",
      rows: [["From", from], ["Type", kind], ["App version", ver]],
      quote: message,
      button: { label: "Open Feedback", path: "/admin/feedback" },
    }),
  );
  return noContent();
}
