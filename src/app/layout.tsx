import type { Metadata } from "next";
import localFont from "next/font/local";
import { RelayProvider } from "@/components/relay-provider";
import { AppShell } from "@/components/app-shell";
import "./globals.css";
import "./workspace.css";

const geist = localFont({
  src: "../../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
  display: "swap",
  variable: "--font-geist",
  weight: "100 900",
});
const fraunces = localFont({
  src: "../../node_modules/@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2",
  display: "swap",
  variable: "--font-fraunces",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: { default: "RELAY — Good things come around", template: "%s · RELAY" },
  description: "Discover your next favorite in somebody else’s collection. A thoughtful exchange for books, records, and games.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${geist.variable} ${fraunces.variable}`}>
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <RelayProvider><AppShell>{children}</AppShell></RelayProvider>
      </body>
    </html>
  );
}
