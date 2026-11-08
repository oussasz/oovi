import { accountsStatus, openSignInWindow, signOutAll } from "@/lib/browser";
import { guard } from "@/lib/guard";
import { loadSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which sites the user has opened in the sign-in browser, and whether it's open. */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(accountsStatus());
}

/** Open the sign-in browser window. */
export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  try {
    await openSignInWindow(loadSettings().browser);
    return Response.json(accountsStatus());
  } catch (e) {
    const msg = (e as Error).message || String(e);
    return Response.json(
      { error: /Executable|not found|Failed to launch/i.test(msg) ? "Couldn't start Chrome or Edge. Install Google Chrome, then try again." : msg.split("\n")[0] },
      { status: 500 },
    );
  }
}

/** Sign out of everything: deletes the saved browser profile. */
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  await signOutAll();
  return Response.json(accountsStatus());
}
