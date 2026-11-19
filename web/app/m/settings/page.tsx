import type { Metadata } from "next";
import { SettingsScreen } from "../_ui/SettingsScreen";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return <SettingsScreen />;
}
