import GroupEditor from "@/components/GroupEditor";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GroupEditor key={id} id={id} />;
}
