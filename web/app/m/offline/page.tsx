import type { Metadata } from "next";
import { OfflineScreen } from "../_ui/OfflineScreen";

export const metadata: Metadata = { title: "Offline" };

export default function Page() {
  return <OfflineScreen />;
}
