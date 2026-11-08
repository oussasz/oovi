import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { bearer } from "better-auth/plugins";
import { pool } from "./db";
import { TERMS_VERSION } from "./legal";
import { siteUrl } from "./site";
import { validateImage, MIN_PASSWORD, MAX_PASSWORD } from "./validation";

export const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 60; // 60 days

function trustedOrigins(): string[] {
  const origins = new Set<string>([siteUrl(), "http://localhost:3200"]);
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
    user: {
      create: {
        before: async (user) => {
          const u = user as typeof user & { termsVersion?: string | null };
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
