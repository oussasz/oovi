import type { Metadata } from "next";
import { ChatScreen } from "../../_ui/ChatScreen";

export const metadata: Metadata = { title: "Chat" };

export default async function Page({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  let id = chatId;
  try {
    id = decodeURIComponent(chatId);
  } catch {
    /* keep it as it came */
  }
  return <ChatScreen key={id} chatId={id.slice(0, 200)} />;
}
