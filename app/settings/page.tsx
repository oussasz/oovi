import { redirect } from "next/navigation";

// Settings is a floating window now; old links open it over the home page.
export default function SettingsPage() {
  redirect("/?settings=1");
}
