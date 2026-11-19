import type { Metadata } from "next";
import { BotsScreen } from "../_ui/BotsScreen";

export const metadata: Metadata = { title: "Bots" };

export default function Page() {
  return <BotsScreen />;
}
