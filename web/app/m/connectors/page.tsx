import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectorsScreen } from "../_ui/ConnectorsScreen";

export const metadata: Metadata = { title: "Connectors" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ConnectorsScreen />
    </Suspense>
  );
}
