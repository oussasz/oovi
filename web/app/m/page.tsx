import type { Metadata } from "next";
import { ChatsScreen } from "./_ui/ChatsScreen";

export const metadata: Metadata = { title: "Chats" };

export default function Page() {
  return <ChatsScreen />;
}
