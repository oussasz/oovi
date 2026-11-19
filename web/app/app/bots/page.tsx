import { redirect } from "next/navigation";

// Bots are in the chat list now (owner, 2026-11-19); old links land there.
export default function Page() {
  redirect("/app");
}
