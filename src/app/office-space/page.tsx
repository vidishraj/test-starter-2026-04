import type { Metadata } from "next";
import Link from "next/link";
import {
  SUBMARKETS,
  SUBMARKET_SLUGS,
  listingsInSubmarket,
} from "@/lib/listings";

export const metadata: Metadata = {
  title: "NYC Office Space by Submarket",
  description:
    "Browse live office listings by Manhattan submarket — Hudson Yards, Flatiron, FiDi, Midtown, SoHo, Tribeca, and more.",
  alternates: { canonical: "/office-space" },
};

export default function OfficeSpaceIndex() {
  const rows = SUBMARKETS.map((s) => ({
    name: s,
    slug: SUBMARKET_SLUGS[s],
    count: listingsInSubmarket(s).length,
  })).sort((a, b) => b.count - a.count);

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <p className="text-xs uppercase tracking-[0.18em] text-accent font-medium">
          By submarket
        </p>
        <h1 className="mt-3 font-display text-5xl sm:text-6xl tracking-tight text-ink leading-[1.05]">
          NYC office space, neighborhood by neighborhood.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted leading-relaxed">
          Each submarket has its own rhythm — Hudson Yards for trophy towers,
          Flatiron for creative lofts, FiDi for value per square foot. Browse
          live listings below, or describe what you&rsquo;re looking for in
          plain English.
        </p>

        <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((r) => (
            <li key={r.slug}>
              <Link
                href={`/office-space/${r.slug}`}
                className="flex items-baseline justify-between rounded-2xl border border-border bg-bg-elevated px-5 py-4 hover:border-ink/40 transition-colors"
              >
                <span className="font-display text-xl tracking-tight text-ink">
                  {r.name}
                </span>
                <span className="font-mono text-xs text-muted-2">
                  {r.count} {r.count === 1 ? "listing" : "listings"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
