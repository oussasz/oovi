import type { Metadata } from "next";
import { ConnectorsScreen } from "../../_ui/ConnectorsScreen";

export const metadata: Metadata = { title: "Connectors" };

export default function Page() {
  return <ConnectorsScreen />;
}
