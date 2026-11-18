// theOovi for the desktop app: the signed-in account pays (lib/ai-messages.ts does the work).
import { getRequestSession } from "@/lib/api";
import { aiMessages } from "@/lib/ai-messages";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await getRequestSession(req);
  return aiMessages(req, session ? { id: session.user.id, emailVerified: !!session.user.emailVerified, via: "app" } : null);
}
