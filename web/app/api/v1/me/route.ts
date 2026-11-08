import { apiError, getRequestSession, json, loadPublicUser, readJson, toPublicUser } from "@/lib/api";
import { pool } from "@/lib/db";
import { validateImage, validateName } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Not signed in or session expired.", 401);
  return json({ user: toPublicUser(session.user) });
}

export async function PATCH(req: Request) {
  const session = await getRequestSession(req);
  if (!session) return apiError("Not signed in or session expired.", 401);
  const body = await readJson(req, 300 * 1024);
  if (!body) return apiError("Invalid JSON body (or body too large).", 400);

  const sets: string[] = [];
  const values: unknown[] = [];
  if ("name" in body) {
    const err = validateName(body.name);
    if (err) return apiError(err, 400);
    values.push((body.name as string).trim());
    sets.push(`name = $${values.length}`);
  }
  if ("image" in body) {
    const err = validateImage(body.image);
    if (err) return apiError(err, 400);
    values.push(body.image ? body.image : null);
    sets.push(`image = $${values.length}`);
  }
  if (sets.length) {
    values.push(session.user.id);
    await pool.query(
      `UPDATE "user" SET ${sets.join(", ")}, "updatedAt" = now() WHERE id = $${values.length}`,
      values,
    );
  }
  const user = await loadPublicUser(session.user.id);
  if (!user) return apiError("Account not found.", 404);
  return json({ user });
}
