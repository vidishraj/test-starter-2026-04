import type { Metadata } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://beyondthespace.example"),
  title: {
    default: "Beyond the Space — NYC office space, described in your words",
    template: "%s — Beyond the Space",
  },
  description:
    "Chat-first NYC office search. Describe the space you need and our AI finds matching listings across Hudson Yards, Flatiron, FiDi, Midtown, and more.",
  openGraph: {
    type: "website",
    title: "Beyond the Space — NYC office space, described in your words",
    description:
      "Chat-first NYC office search. Describe the space you need and our AI finds matching listings across Manhattan.",
    siteName: "Beyond the Space",
  },
  twitter: {
    card: "summary_large_image",
    title: "Beyond the Space",
    description:
      "Chat-first NYC office search. Describe the space you need and let AI find it.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border">
          <div className="mx-auto max-w-6xl px-6 py-5 flex items-center justify-between">
            <Link href="/" className="font-display text-[19px] tracking-tight text-ink">
              Beyond the Space<span className="text-accent">.</span>
            </Link>
            <nav className="flex items-center gap-6 text-sm text-muted">
              <Link href="/search" className="hover:text-fg transition-colors">
                Search
              </Link>
              <span className="text-muted-2 cursor-not-allowed" aria-disabled>
                For brokers
              </span>
            </nav>
          </div>
        </header>
        <div className="flex-1 flex flex-col">{children}</div>
        <footer className="border-t border-border">
          <div className="mx-auto max-w-6xl px-6 py-8 flex items-center justify-between text-xs text-muted">
            <span>© Beyond the Space. Synthetic data for demo purposes.</span>
            <span className="font-mono">NYC · Office</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
