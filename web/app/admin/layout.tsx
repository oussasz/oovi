import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { AdminNav } from "@/components/admin/AdminNav";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { default: "Admin", template: "%s · oovi admin" },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="adm">
      <header className="adm-top">
        <div className="adm-brand">
          <Logo size={34} href="/admin" />
          <span className="pill">Admin</span>
        </div>
        <div className="adm-who">
          <span title={admin.email}>{`Signed in as ${admin.email}`}</span>
          <Link href="/" className="btn btn-ghost btn-sm">
            Back to site
          </Link>
        </div>
      </header>
      <div className="adm-shell">
        <AdminNav />
        <main className="adm-main">{children}</main>
      </div>
    </div>
  );
}
