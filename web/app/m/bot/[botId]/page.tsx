import type { Metadata } from "next";
import { BotEditScreen } from "../../_ui/Editors";

export const metadata: Metadata = { title: "Edit bot" };

export default async function Page({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  return <BotEditScreen key={botId} botId={botId.replace(/[^\w-]/g, "").slice(0, 64)} />;
}
