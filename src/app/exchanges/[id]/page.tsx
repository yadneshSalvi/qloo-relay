import { ExchangesView } from "@/components/exchanges-view";
export default async function ExchangePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExchangesView proposalId={id} />;
}
