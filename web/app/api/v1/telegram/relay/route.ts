// The app turns the Telegram relay on (or updates it), or off (lib/telegram-relay.ts).
import { apiError, getRequestSession, noContent, rateLimit, readJson } from "@/lib/api";
import { getConnection, registerRelay, RelayGone, removeRelay, TOKEN_RE } from "@/lib/telegram-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The account's connection, for a computer that hasn't connected Telegram yet: {token, config, connectedAt}, {disconnectedAt} or 404. */
export async function GET(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  if (!rateLimit(`tgrelay:get:${session.user.id}`, 60, 60 * 60_000)) return apiError("Too many requests. Try again later.", 429);
  const c = await getConnection(session.user.id);
  if (!c) return apiError("Telegram isn't connected on this account.", 404);
  return Response.json(c, { headers: { "cache-control": "no-store" } });
}

/** {token, chats: number[], language, config, connectedAt}: 410 when Telegram was disconnected since (on another computer). */
export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  if (!rateLimit(`tgrelay:${session.user.id}`, 20, 60 * 60_000)) return apiError("Too many requests. Try again later.", 429);
  const b = await readJson(req, 16 * 1024);
  const token = typeof b?.token === "string" ? b.token.trim() : "";
  if (!TOKEN_RE.test(token)) return apiError("That isn't a Telegram bot token.", 400);
  const chats = (Array.isArray(b?.chats) ? b.chats : []).map(Number).filter((n) => Number.isSafeInteger(n) && n !== 0).slice(0, 50);
  const language = typeof b?.language === "string" && /^[a-z]{2}(-[A-Z]{2})?$/.test(b.language) ? b.language : "en";
  const config = b?.config && typeof b.config === "object" && !Array.isArray(b.config) && JSON.stringify(b.config).length < 8000 ? (b.config as Record<string, unknown>) : {};
  const connectedAt = Number(b?.connectedAt) || 0;
  try {
    await registerRelay(session.user.id, token, chats, language, config, connectedAt);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof RelayGone) return apiError(err.message, 410);
    return apiError(`Telegram refused: ${err instanceof Error ? err.message.slice(0, 200) : "unknown error"}`, 502);
  }
}

export async function DELETE(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Sign in first.", 401);
  await removeRelay(session.user.id).catch(() => {});
  return noContent();
}
