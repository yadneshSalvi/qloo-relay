import { DiscoverView } from "@/components/discover-view";
export default async function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DiscoverView initialItemId={id} />;
}
