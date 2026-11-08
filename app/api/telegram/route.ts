import { guard } from "@/lib/guard";
import { connect, disconnect, sendTest, startTelegram, status } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Telegram link status for Settings. Also makes sure the listener runs. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  startTelegram();
  return Response.json(status());
}

/** {token} saves a bot token from @BotFather; {action:"test"} sends a test message. */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { token?: unknown; action?: unknown } | null;
  try {
    if (body?.action === "test") {
      await sendTest();
      return Response.json(status());
    }
    if (typeof body?.token === "string") return Response.json(await connect(body.token));
    return Response.json({ error: "Send {token} or {action: 'test'}." }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(disconnect());
}
