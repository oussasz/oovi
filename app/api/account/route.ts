import { CloudError, clearSession, cloud, cloudUrl, currentSession, saveSession, setOnboarded, updateSessionUser, type AccountUser } from "@/lib/account";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function state() {
  const s = currentSession();
  return { loggedIn: !!s, user: s?.user ?? null, onboarded: !!s?.onboarded, cloudUrl: cloudUrl(), appVersion: process.env.OOVI_VERSION || process.env.npm_package_version || "dev" };
}

const fail = (e: unknown) =>
  Response.json({ error: (e as Error).message || "Something went wrong." }, { status: e instanceof CloudError && e.status >= 400 ? e.status : 502 });

/** Current account. ?refresh=1 re-checks the session with the account service. */
export async function GET(req: Request) {
  const denied = guard(req, { account: false });
  if (denied) return denied;
  if (currentSession() && new URL(req.url).searchParams.get("refresh")) {
    try {
      const { user } = await cloud<{ user: AccountUser }>("/api/v1/me", { auth: true });
      updateSessionUser(user);
    } catch (e) {
      if (e instanceof CloudError && e.status === 401) clearSession(); // expired or revoked
      // offline: keep working with the saved session
    }
  }
  return Response.json(state());
}

/**
 * {action: "signin" | "signup" | "verify" | "resend" | "onboarded", ...}
 * signin/signup answer {..., verify: {email}} when the email must be confirmed first: the app then asks
 * for the 6-digit code from the email (verify: {email, code}; resend: {email} sends a new one).
 */
export async function POST(req: Request) {
  const denied = guard(req, { account: false });
  if (denied) return denied;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    if (b.action === "signin" || b.action === "signup") {
      const body =
        b.action === "signin"
          ? { email: String(b.email ?? "").trim(), password: String(b.password ?? "") }
          : { name: String(b.name ?? "").trim(), email: String(b.email ?? "").trim(), password: String(b.password ?? ""), acceptTerms: b.acceptTerms === true };
      const r = await cloud<{ token?: string; user?: AccountUser; verify?: boolean; email?: string }>(`/api/v1/auth/${b.action === "signin" ? "sign-in" : "sign-up"}`, { method: "POST", body });
      if (r.verify) return Response.json({ ...state(), verify: { email: String(r.email ?? body.email) } });
      if (!r.token || !r.user) return Response.json({ error: "The account service gave an unexpected answer. Please try again." }, { status: 502 });
      saveSession(r.token, r.user);
      return Response.json(state());
    }
    if (b.action === "verify") {
      const r = await cloud<{ token: string; user: AccountUser }>("/api/v1/auth/verify-email", { method: "POST", body: { email: String(b.email ?? "").trim(), code: String(b.code ?? "").trim() } });
      saveSession(r.token, r.user);
      return Response.json(state());
    }
    if (b.action === "resend") {
      await cloud("/api/v1/auth/resend-code", { method: "POST", body: { email: String(b.email ?? "").trim() } });
      return Response.json({ ...state(), sent: true });
    }
    if (b.action === "onboarded") {
      if (!currentSession()) return Response.json({ error: "Sign in first." }, { status: 401 });
      setOnboarded(true);
      return Response.json(state());
    }
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}

/** Profile: {name?, image?} (image = data URL, or null to remove). Stored in the oovi account. */
export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = ((await req.json().catch(() => null)) ?? {}) as { name?: unknown; image?: unknown };
  const patch: { name?: string; image?: string | null } = {};
  if (typeof b.name === "string") patch.name = b.name.trim().slice(0, 60);
  if (b.image === null || (typeof b.image === "string" && b.image.startsWith("data:image/") && b.image.length <= 280_000)) patch.image = b.image as string | null;
  try {
    const { user } = await cloud<{ user: AccountUser }>("/api/v1/me", { method: "PATCH", body: patch, auth: true });
    updateSessionUser(user);
    return Response.json(state());
  } catch (e) {
    return fail(e);
  }
}

/** Sign out on this computer. Local data stays in the account's folder for next time. */
export async function DELETE(req: Request) {
  const denied = guard(req, { account: false });
  if (denied) return denied;
  await cloud("/api/v1/auth/sign-out", { method: "POST", auth: true }).catch(() => {});
  clearSession();
  return Response.json(state());
}
