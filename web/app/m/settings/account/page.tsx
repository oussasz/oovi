import type { Metadata } from "next";
import { AccountScreen } from "../../_ui/AccountScreen";

export const metadata: Metadata = { title: "Account" };

export default function Page() {
  return <AccountScreen />;
}
