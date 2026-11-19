import type { Metadata } from "next";
import { GroupEditScreen } from "../../_ui/Editors";

export const metadata: Metadata = { title: "Edit group" };

export default async function Page({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return <GroupEditScreen key={groupId} groupId={groupId.replace(/[^\w-]/g, "").slice(0, 64)} />;
}
