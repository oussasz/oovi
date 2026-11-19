import type { Metadata } from "next";
import { ConnectorScreen } from "../../_ui/ConnectorScreen";

export const metadata: Metadata = { title: "Connector" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let v = id;
  try {
    v = decodeURIComponent(id);
  } catch {
    /* as it came */
  }
  return <ConnectorScreen key={v} id={v.slice(0, 100)} />;
}
