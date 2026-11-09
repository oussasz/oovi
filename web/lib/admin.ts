import { cache } from "react";
import { notFound } from "next/navigation";
import { getServerSession } from "./session";

export type Admin = { id: string; email: string; name: string };

/** Emails from ADMIN_EMAILS (comma-separated, case-insensitive). Unset = nobody. */
function adminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().has(email.trim().toLowerCase());
}

/** The signed-in website user if they are an admin, else null. Cached per request. */
export const getAdmin = cache(async (): Promise<Admin | null> => {
  const session = await getServerSession();
  if (!session?.user) return null;
  const { id, email, name } = session.user;
  if (!isAdminEmail(email)) return null;
  return { id, email, name };
});

/**
 * Use at the top of every admin page and server action. Non-admins get a plain
 * 404, so the console's existence isn't revealed.
 */
export async function requireAdmin(): Promise<Admin> {
  const admin = await getAdmin();
  if (!admin) notFound();
  return admin;
}
