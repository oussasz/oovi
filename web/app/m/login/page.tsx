import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginScreen } from "../_ui/LoginScreen";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LoginScreen />
    </Suspense>
  );
}
