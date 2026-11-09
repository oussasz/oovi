// Paddle.js settings for the browser. Only the public client-side token lives here; a Paddle
// server API key must never be read in this file or sent to the browser.
//
// The environment is never guessed: if NEXT_PUBLIC_PADDLE_ENV is missing or doesn't match the
// token, this throws, so the site can't quietly run against the wrong Paddle account.

export type PaddleClientConfig = { environment: "production" | "sandbox"; token: string };

export function paddleClientConfig(): PaddleClientConfig {
  const environment = process.env.NEXT_PUBLIC_PADDLE_ENV;
  const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
  if (environment !== "production" && environment !== "sandbox") {
    throw new Error(`NEXT_PUBLIC_PADDLE_ENV must be "production" or "sandbox" (it is ${environment ? `"${environment}"` : "not set"}).`);
  }
  if (!token) throw new Error("NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is not set.");
  const prefix = environment === "production" ? "live_" : "test_";
  if (!token.startsWith(prefix)) {
    throw new Error(`NEXT_PUBLIC_PADDLE_CLIENT_TOKEN must start with "${prefix}" when NEXT_PUBLIC_PADDLE_ENV is "${environment}".`);
  }
  return { environment, token };
}
