import { OrganizerView } from "@/components/organizer-view";
export default async function HandoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrganizerView proposalId={id} />;
}
