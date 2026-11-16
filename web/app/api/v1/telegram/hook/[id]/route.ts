// Telegram sends messages for a user's bot here (lib/telegram-relay.ts). Checked with the secret Telegram
// sends back in X-Telegram-Bot-Api-Secret-Token. Always answers 200 quickly (Telegram retries otherwise),
// except for an unknown hook or a wrong secret.
import { receive } from "@/lib/telegram-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f]{32}$/.test(id)) return new Response("Not found", { status: 404 });
  const text = await req.text();
  if (text.length > 256 * 1024) return new Response("Too big", { status: 413 });
  let update: unknown;
  try {
    update = JSON.parse(text);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  try {
    const ok = await receive(id, req.headers.get("x-telegram-bot-api-secret-token"), update as Parameters<typeof receive>[2]);
    return ok ? new Response(null, { status: 200 }) : new Response("Not found", { status: 404 });
  } catch (err) {
    console.error("telegram hook failed", err instanceof Error ? err.message : err);
    return new Response(null, { status: 500 }); // Telegram tries again later
  }
}
