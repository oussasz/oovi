import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { getServerSession } from "@/lib/session";
import { toPublicUser } from "@/lib/api";
import { AccountClient } from "./AccountClient";

export const metadata: Metadata = { title: "Your account" };
export const dynamic = "force-dynamic";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  const { welcome } = await searchParams;
  return (
    <>
      <SiteNav />
      <main className="container page">
        <AccountClient user={toPublicUser(session.user)} welcome={welcome === "1"} />
      </main>
      <SiteFooter />
    </>
  );
}
