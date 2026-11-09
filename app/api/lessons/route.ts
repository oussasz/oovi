import { guard } from "@/lib/guard";
import { deleteLesson, editLesson, listLessons, scoreLesson } from "@/lib/learning";
import { listBots } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const view = () => {
  const bots = listBots();
  return {
    lessons: listLessons()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((l) => ({ ...l, botName: bots.find((b) => b.id === l.botId)?.name })),
  };
};

/** Everything the bots learned (newest first). */
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  return Response.json(view());
}

/** {id, text}: edit a lesson. */
export async function PUT(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = ((await req.json().catch(() => null)) ?? {}) as { id?: unknown; text?: unknown };
  if (typeof b.id !== "string" || typeof b.text !== "string") return Response.json({ error: "Send {id, text}." }, { status: 400 });
  if (!editLesson(b.id, b.text)) return Response.json({ error: "Couldn't save that lesson." }, { status: 400 });
  return Response.json(view());
}

/** {id, delta: 1 | -1}: raise or lower a lesson's score (0 = never recalled). */
export async function PATCH(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const b = ((await req.json().catch(() => null)) ?? {}) as { id?: unknown; delta?: unknown };
  if (typeof b.id !== "string" || typeof b.delta !== "number" || !b.delta) return Response.json({ error: "Send {id, delta}." }, { status: 400 });
  if (!scoreLesson(b.id, b.delta)) return Response.json({ error: "Lesson not found." }, { status: 404 });
  return Response.json(view());
}

/** ?id=…: forget a lesson. */
export async function DELETE(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id." }, { status: 400 });
  deleteLesson(id);
  return Response.json(view());
}
