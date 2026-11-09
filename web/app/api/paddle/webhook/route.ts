// Paddle webhook deliveries (notification destination "oovi website: subscriptions, credits and
// billing"). The signature is checked on the raw body before anything else; only verified events
// reach lib/billing.ts. Any non-2xx answer makes Paddle retry, so failures return 4xx/5xx.
import { NodeRuntime, Webhooks } from "@paddle/paddle-node-sdk";
import { handlePaddleEvent } from "@/lib/billing";
import { pool } from "@/lib/db";
import { paddleWebhookSecret } from "@/lib/paddle-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The SDK registers its Node crypto only when a Paddle API client is built. Without this,
// every signature check fails (no API key is needed to verify webhooks).
NodeRuntime.initialize();
const webhooks = new Webhooks();

export async function POST(req: Request) {
  const secret = paddleWebhookSecret();
  if (!secret) {
    console.error("[paddle] PADDLE_WEBHOOK_SECRET is not set; refusing the delivery so Paddle retries later.");
    return Response.json({ error: "Webhooks aren't set up." }, { status: 503 });
  }
  const signature = req.headers.get("paddle-signature");
  // The raw text exactly as sent: a parsed and re-serialized body would fail verification.
  const raw = await req.text();
  if (!signature || !raw) return Response.json({ error: "Missing signature." }, { status: 400 });

  let event;
  try {
    event = await webhooks.unmarshal(raw, secret, signature);
  } catch {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  // Already handled (Paddle delivers at least once): say so and stop.
  const seen = await pool.query("SELECT 1 FROM paddle_events WHERE event_id = $1", [event.eventId]);
  if (seen.rowCount) return Response.json({ ok: true, duplicate: true });

  try {
    const result = await handlePaddleEvent(event);
    await pool.query(
      "INSERT INTO paddle_events (event_id, event_type, occurred_at) VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING",
      [event.eventId, event.eventType, event.occurredAt],
    );
    return Response.json({ ok: true, result });
  } catch (err) {
    console.error(`[paddle] ${event.eventType} ${event.eventId} failed:`, err instanceof Error ? err.message : err);
    return Response.json({ error: "Processing failed; Paddle will retry." }, { status: 500 });
  }
}
