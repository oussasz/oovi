import { checkBotId } from "botid/server";
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

const handler = toNextJsHandler(auth.handler);

export const GET = handler.GET;

/** Sign-ups from the website form must pass Vercel BotID (instrumentation-client.ts). */
export async function POST(req: Request) {
  if (new URL(req.url).pathname === "/api/auth/sign-up/email") {
    let bot = false;
    try {
      bot = (await checkBotId()).isBot;
    } catch (err) {
      // BotID unreachable: don't lock real people out; the sign-up guard still applies.
      console.error("[botid] check failed", err instanceof Error ? err.message : err);
    }
    if (bot) {
      return Response.json(
        { code: "BOT_DETECTED", message: "We couldn't confirm you're a person. Please reload the page and try again." },
        { status: 403 },
      );
    }
  }
  return handler.POST(req);
}
