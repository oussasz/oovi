// Whether new accounts confirm their email before they open (console setting + email that can be sent).
import { json } from "@/lib/api";
import { verificationRequired } from "@/lib/mail";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({ required: await verificationRequired() });
}
