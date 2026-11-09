import { headers } from "next/headers";

/** The visitor's IP for server components and actions (used only for the hashed signup-grant limit). */
export async function requestIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || null;
  return h.get("x-real-ip");
}
