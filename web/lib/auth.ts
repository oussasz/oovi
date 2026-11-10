import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { bearer } from "better-auth/plugins";
import { checkSignup } from "./signup-guard";
import { pool } from "./db";
import { isBlocked } from "./credits";
import { sendInBackground } from "./mail";
import { passwordChanged, resetPassword, verifyEmail } from "./mail-templates";
import { TERMS_VERSION } from "./legal";
import { siteUrl } from "./site";
import { validateImage, MIN_PASSWORD, MAX_PASSWORD } from "./validation";

export const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 60; // 60 days

function trustedOrigins(): string[] {
  // Both addresses: the site moved to oovi.conuron.com, older links and apps may use the old one.
  const origins = new Set<string>([siteUrl(), "https://oovi.conuron.com", "https://oovi.vercel.app", "http://localhost:3200"]);
  for (const v of [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]) {
    if (v) origins.add(`https://${v}`);
  }
  return [...origins];
}

export const auth = betterAuth({
  appName: "oovi",
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: siteUrl(),
  basePath: "/api/auth",
  trustedOrigins: trustedOrigins(),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: MIN_PASSWORD,
    maxPasswordLength: MAX_PASSWORD,
    // Password reset by email (through the SMTP server set in the console).
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      sendInBackground(resetPassword(user.email, user.name, url));
    },
    onPasswordReset: async ({ user }) => {
      sendInBackground(passwordChanged(user.email, user.name));
    },
  },
  // Email confirmation: sent on sign-up and on request ("Resend email" in the app).
  // People can still sign in before confirming; free theOovi credits wait for it
  // when the console says so.
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      const link = new URL(url);
      link.searchParams.set("callbackURL", "/verified");
      sendInBackground(verifyEmail(user.email, user.name, link.toString()));
    },
  },
  session: {
    expiresIn: SESSION_LIFETIME_SECONDS,
    updateAge: 60 * 60 * 24, // refresh expiry at most once a day
  },
  user: {
    additionalFields: {
      termsVersion: { type: "string", required: false, input: true },
      termsAcceptedAt: { type: "date", required: false, input: false },
    },
    deleteUser: { enabled: true },
  },
  databaseHooks: {
    session: {
      create: {
        // Accounts blocked in the admin console can't sign in (web or app).
        before: async (session) => {
          if (await isBlocked(session.userId)) {
            throw new APIError("FORBIDDEN", { message: "This account has been blocked. Contact contact@conuron.com." });
          }
          return { data: session };
        },
      },
    },
    user: {
      create: {
        before: async (user, ctx) => {
          const u = user as typeof user & { termsVersion?: string | null };
          // Fake and mass sign-ups (lib/signup-guard.ts).
          const verdict = await checkSignup(String(user.email ?? ""), ctx?.headers ?? ctx?.request?.headers);
          if (!verdict.ok) throw new APIError("BAD_REQUEST", { message: verdict.message });
          if (u.termsVersion !== TERMS_VERSION) {
            throw new APIError("BAD_REQUEST", {
              message: "You must accept the Terms of Service and Privacy Policy.",
            });
          }
          const imageError = validateImage(u.image);
          if (imageError) throw new APIError("BAD_REQUEST", { message: imageError });
          return { data: { ...user, termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() } };
        },
      },
      update: {
        before: async (data) => {
          const d = { ...(data as Record<string, unknown>) };
          delete d.termsVersion;
          delete d.termsAcceptedAt;
          if ("image" in d) {
            const imageError = validateImage(d.image);
            if (imageError) throw new APIError("BAD_REQUEST", { message: imageError });
          }
          return { data: d as typeof data };
        },
      },
    },
  },
  advanced: {
    ipAddress: { ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] },
  },
  plugins: [bearer()],
});

export type Session = typeof auth.$Infer.Session;
