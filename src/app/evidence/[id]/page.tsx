import { EvidenceView } from "@/components/evidence-view";
export default async function EvidenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EvidenceView evidenceId={id} />;
}
