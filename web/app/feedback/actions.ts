"use server";

import { getServerSession } from "@/lib/session";
import { rateLimit } from "@/lib/api";
import { isBlocked } from "@/lib/credits";
import { pool } from "@/lib/db";
import { fdStr } from "@/lib/form";
import { notify } from "@/lib/notify";
import { later } from "@/lib/user-signals";

export type FeedbackFormState = { ok?: boolean; errors?: string[] } | null;

const KINDS = new Set(["problem", "improvement", "other"]);

export async function sendFeedback(_prev: FeedbackFormState, fd: FormData): Promise<FeedbackFormState> {
  const session = await getServerSession();
  if (!session?.user) return { errors: ["Please log in again, then send your feedback."] };
  const userId = session.user.id;
  if (await isBlocked(userId)) return { errors: ["This account can’t send feedback."] };
  if (!rateLimit(`feedback:${userId}`, 10, 10 * 60_000)) {
    return { errors: ["You’ve sent a lot of feedback in a short time. Please wait a few minutes."] };
  }
  const kind = fdStr(fd, "kind", 20);
  const message = fdStr(fd, "message", 6000).trim();
  const errors: string[] = [];
  if (!KINDS.has(kind)) errors.push("Pick a type: a problem, an improvement or something else.");
  if (message.length < 5) errors.push("Please write a few words (at least 5 characters).");
  if (message.length > 5000) errors.push("Please keep it under 5,000 characters.");
  if (errors.length) return { errors };

  try {
    // A second limit that holds across server instances.
    const { rows } = await pool.query<{ c: string }>(
      "SELECT count(*) AS c FROM feedback WHERE user_id = $1 AND created_at > now() - interval '1 hour'",
      [userId],
    );
    if (Number(rows[0]?.c ?? 0) >= 30) return { errors: ["You’ve sent a lot of feedback in the last hour. Please try again later."] };
    await pool.query("INSERT INTO feedback (user_id, kind, message, source) VALUES ($1, $2, $3, 'web')", [userId, kind, message]);
    const from = session.user.email;
    later(() =>
      notify({
        event: "feedback",
        title: `New feedback (${kind}) from ${from}`,
        lead: "Someone sent feedback from the website.",
        rows: [["From", from], ["Type", kind]],
        quote: message,
        button: { label: "Open Feedback", path: "/admin/feedback" },
      }),
    );
  } catch (err) {
    console.error("web feedback failed", err instanceof Error ? err.message : err);
    return { errors: ["Could not send your feedback. Please try again."] };
  }
  return { ok: true };
}
