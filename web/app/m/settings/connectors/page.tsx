import { redirect } from "next/navigation";

// Connectors moved to /m/connectors (where the website's sign-in callback returns).
export default function Page() {
  redirect("/m/connectors");
}
