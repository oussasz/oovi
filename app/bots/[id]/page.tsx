import BotEditor from "@/components/BotEditor";

export default async function BotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BotEditor key={id} id={id} />;
}
