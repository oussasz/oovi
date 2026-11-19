import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { audienceReport, emailCounts, getAnnouncement } from "@/lib/announcements";
import { PageHead } from "@/components/admin/ui";
import { AnnEditor } from "./AnnEditor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Announcement" };

export default async function EditAnnouncement({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const admin = await requireAdmin();
  const { id } = await searchParams;
  const a = id ? await getAnnouncement(id) : null;
  const counts = a?.email ? await emailCounts(a).catch(() => null) : null;
  const people = a?.testEmail ? await audienceReport(a).catch(() => []) : [];
  return (
    <>
      <PageHead title={a ? a.title : "New announcement"} sub="Write it in HTML, check the preview, send it to the people you choose (one or several) or to everyone.">
        <Link href="/admin/announcements" className="btn btn-ghost btn-sm">
          All announcements
        </Link>
      </PageHead>
      {id && !a ? <p>This announcement no longer exists.</p> : <AnnEditor key={a?.updatedAt ?? "new"} a={a} adminEmail={admin.email} counts={counts} people={people} />}
    </>
  );
}
