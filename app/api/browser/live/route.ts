import { peekSession } from "@/lib/browser";
import { addViewer, liveTarget, type LiveMeta, type LiveMsg } from "@/lib/browser-live";
import { guard } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000;
const STATE_MS = 5_000;

/**
 * GET ?chat=<id>&bot=<id>: an NDJSON stream of the bot's browser, live.
 * {type:"frame", data: base64 JPEG, w, h, url, title, controlled, request}, {type:"state", ...},
 * {type:"ping"} keepalives and {type:"end"} when the browser closes. Frames are dropped
 * (never queued) when the reader is slow. Stops when the client disconnects.
 */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const q = new URL(req.url).searchParams;
  const target = liveTarget(q.get("chat"), q.get("bot"));
  if (target instanceof Response) return target;
  const { sessionId } = target;
  if (!peekSession(sessionId)) return Response.json({ error: "The bot's browser is closed." }, { status: 404 });

  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        let closed = false;
        let ping: ReturnType<typeof setInterval> | undefined;
        let state: ReturnType<typeof setInterval> | undefined;
        let unsub = () => {};
        let meta: LiveMeta | null = null;
        const remember = (m: LiveMsg) => {
          if (m.type !== "end") meta = { url: m.url, title: m.title, controlled: m.controlled, ...(m.request ? { request: m.request } : {}) };
        };
        const write = (m: LiveMsg | { type: "ping" }) => {
          if (closed) return;
          try {
            controller.enqueue(enc.encode(`${JSON.stringify(m)}\n`));
          } catch {
            close();
          }
        };
        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(ping);
          clearInterval(state);
          unsub();
          req.signal.removeEventListener("abort", close);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        unsub = addViewer(sessionId, {
          // Drop frames while the client hasn't read the previous ones (no unbounded queue).
          frame: (m) => {
            remember(m);
            if ((controller.desiredSize ?? 1) > 0) write(m);
          },
          state: (m) => {
            remember(m);
            write(m);
          },
          end: () => {
            write({ type: "end" });
            close();
          },
        });
        ping = setInterval(() => write({ type: "ping" }), KEEPALIVE_MS);
        state = setInterval(() => {
          if (meta) write({ type: "state", ...meta });
        }, STATE_MS);
        if (closed) unsub();
        req.signal.addEventListener("abort", close);
        if (req.signal.aborted) close();
        cleanup = close;
      },
      cancel() {
        cleanup();
      },
    },
    { highWaterMark: 2 },
  );
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
}
