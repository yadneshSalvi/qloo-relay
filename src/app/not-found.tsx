import Link from "next/link";
export default function NotFoundPage() {
  return <div className="error-state"><span className="eyebrow">Off the shelf</span><h1>This page has moved on.</h1><p>There are still good things waiting in the neighborhood collection.</p><Link className="button primary" href="/discover">Explore the shelf</Link></div>;
}
