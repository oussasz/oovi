// Request bodies for the routines API: JSON objects only, and small.
const MAX_BODY = 32_000;

export async function readBody(req: Request): Promise<Record<string, unknown> | Response> {
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "Request too large." }, { status: 413 });
  try {
    const v = JSON.parse(raw) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  return Response.json({ error: "Send a JSON object." }, { status: 400 });
}
