"use client";

import Link from "next/link";
import { authClient } from "@/lib/auth-client";

/** "Log in", or "Open oovi" (the web app) once signed in (checked in the browser so pages stay cached). */
export function NavAccount() {
  const { data } = authClient.useSession();
  return data?.user ? (
    <Link href="/app" className="nav-login">
      Open oovi
    </Link>
  ) : (
    <Link href="/login" className="nav-login">
      Log in
    </Link>
  );
}
