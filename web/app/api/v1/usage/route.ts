import { apiError, getRequestSession, noContent, rateLimit, readJson } from "@/lib/api";
import { saveUsageReport, validateUsageReport } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/usage  (Authorization: Bearer <token>)
 * The desktop app reports one day of usage numbers (never chat content).
 * Sending the same day again replaces that day's counts. Returns 204.
 */
export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Not signed in or session expired.", 401);
  if (!rateLimit(`usage:${session.user.id}`, 30)) {
    return apiError("Too many usage reports. Please slow down.", 429);
  }
  const body = await readJson(req, 8 * 1024);
  if (!body) return apiError("Invalid JSON body (or body too large).", 400);

  const report = validateUsageReport(body);
  if (typeof report === "string") return apiError(report, 400);

  try {
    await saveUsageReport(session.user.id, report);
  } catch (err) {
    console.error("usage report save failed", err);
    return apiError("Could not store the usage report.", 500);
  }
  return noContent();
}
