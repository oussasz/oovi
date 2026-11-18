import type { Metadata } from "next";
import { AddConnectorScreen } from "../../_ui/AddConnectorScreen";

export const metadata: Metadata = { title: "Add a connector" };

export default function Page() {
  return <AddConnectorScreen />;
}
