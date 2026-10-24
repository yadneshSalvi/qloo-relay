"use client";
import { RotateCcw } from "lucide-react";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <div className="error-state"><span className="eyebrow">A small interruption</span><h1>Let’s try that again.</h1><p>Your saved exchanges are still on the shelf. Reload this view to reconnect.</p><button className="button primary" onClick={reset}><RotateCcw size={16} /> Try again</button></div>;
}
