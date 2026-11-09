// Paddle on the server only. PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET have no NEXT_PUBLIC_ prefix,
// so they never reach the browser; never import this file from a "use client" component.
import { Environment, Paddle } from "@paddle/paddle-node-sdk";

/** The Paddle account in use. Never guessed: a missing or unknown NEXT_PUBLIC_PADDLE_ENV throws. */
export function paddleEnvironment(): Environment {
  const env = process.env.NEXT_PUBLIC_PADDLE_ENV;
  if (env === "production") return Environment.production;
  if (env === "sandbox") return Environment.sandbox;
  throw new Error(`NEXT_PUBLIC_PADDLE_ENV must be "production" or "sandbox" (it is ${env ? `"${env}"` : "not set"}).`);
}

/**
 * Paddle API client, or null while PADDLE_API_KEY isn't set (billing management is then
 * unavailable, nothing else breaks). A live key with the sandbox setting (or the reverse) throws.
 */
export function paddleApi(): Paddle | null {
  const key = process.env.PADDLE_API_KEY;
  if (!key) return null;
  const environment = paddleEnvironment();
  const live = environment === Environment.production;
  if (live ? key.startsWith("pdl_sdbx_") : key.startsWith("pdl_live_")) {
    throw new Error(`PADDLE_API_KEY is a ${live ? "sandbox" : "live"} key but NEXT_PUBLIC_PADDLE_ENV is "${process.env.NEXT_PUBLIC_PADDLE_ENV}".`);
  }
  return new Paddle(key, { environment });
}

/** The signing secret of the webhook destination (Paddle > Developer tools > Notifications). Not the API key. */
export function paddleWebhookSecret(): string | null {
  return process.env.PADDLE_WEBHOOK_SECRET || null;
}
