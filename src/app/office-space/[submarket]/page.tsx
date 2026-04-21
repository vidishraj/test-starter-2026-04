import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ListingCard from "@/components/listing-card";
import {
  SUBMARKETS,
  SUBMARKET_SLUGS,
  submarketFromSlug,
  listingsInSubmarket,
  formatSf,
} from "@/lib/listings";

type Params = { submarket: string };

export function generateStaticParams(): Params[] {
  return SUBMARKETS.map((s) => ({ submarket: SUBMARKET_SLUGS[s] }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { submarket } = await params;
  const canonical = submarketFromSlug(submarket);
  if (!canonical) return { title: "Submarket not found" };

  const listings = listingsInSubmarket(canonical);
  const sfLo = listings.length ? Math.min(...listings.map((l) => l.sf)) : 0;
  const sfHi = listings.length ? Math.max(...listings.map((l) => l.sf)) : 0;

  const title = `Office Space in ${canonical}, NYC`;
  const description = listings.length
    ? `${listings.length} office listing${listings.length === 1 ? "" : "s"} in ${canonical}, from ${formatSf(sfLo)} to ${formatSf(sfHi)} SF. Sublease and direct availability across Manhattan.`
    : `Office space in ${canonical}, NYC. Describe what you need and Beyond the Space will match you to the right listing.`;

  return {
    title,
    description,
    alternates: { canonical: `/office-space/${submarket}` },
    openGraph: {
      type: "website",
      title,
      description,
      images: listings[0]?.heroImage ? [{ url: listings[0].heroImage }] : undefined,
    },
  };
}

export default async function SubmarketPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { submarket } = await params;
  const canonical = submarketFromSlug(submarket);
  if (!canonical) notFound();

  const listings = listingsInSubmarket(canonical);
  const related = SUBMARKETS.filter((s) => s !== canonical).slice(0, 5);

  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Office space in ${canonical}, NYC`,
    numberOfItems: listings.length,
    itemListElement: listings.map((l, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `https://beyondthespace.example/listings/${l.slug}`,
      name: `${l.address} ${l.unit}`,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6 pt-8">
          <nav className="text-xs uppercase tracking-[0.14em] text-muted-2">
            <Link href="/" className="hover:text-fg">
              Home
            </Link>
            <span className="mx-2">/</span>
            <Link href="/office-space" className="hover:text-fg">
              Office space
            </Link>
            <span className="mx-2">/</span>
            <span className="text-muted">{canonical}</span>
          </nav>

          <header className="mt-6 border-b border-border pb-10">
            <p className="text-xs uppercase tracking-[0.18em] text-accent font-medium">
              NYC office space
            </p>
            <h1 className="mt-3 font-display text-5xl sm:text-6xl tracking-tight text-ink leading-[1.05]">
              {canonical}
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted leading-relaxed">
              {listings.length === 0
                ? `No live listings in ${canonical} right now. Describe what you need and we'll alert you the moment something matches.`
                : `${listings.length} listing${listings.length === 1 ? "" : "s"} currently available in ${canonical}. Filter by headcount, sublease vs. direct, or describe your ideal space in plain English.`}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={`/search?q=${encodeURIComponent(`office space in ${canonical}`)}`}
                className="rounded-full bg-ink text-white px-5 py-2.5 text-sm font-medium hover:bg-black transition-colors"
              >
                AI-search {canonical}
              </Link>
              <Link
                href="/"
                className="rounded-full border border-border px-5 py-2.5 text-sm text-muted hover:text-fg hover:border-ink transition-colors"
              >
                Change submarket
              </Link>
            </div>
          </header>

          <section className="mt-10">
            {listings.length === 0 ? (
              <p className="text-muted">
                Browse{" "}
                <Link href="/search?q=all%20listings" className="text-ink underline">
                  the full catalog
                </Link>{" "}
                or pick a nearby submarket below.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {listings.map((l, i) => (
                  <ListingCard key={l.id} listing={l} priority={i < 3} />
                ))}
              </div>
            )}
          </section>

          <section className="mt-16 border-t border-border pt-10">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-2">
              Related submarkets
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {related.map((s) => (
                <Link
                  key={s}
                  href={`/office-space/${SUBMARKET_SLUGS[s]}`}
                  className="rounded-full border border-border bg-bg-elevated px-4 py-2 text-sm text-muted hover:text-fg hover:border-ink transition-colors"
                >
                  {s}
                </Link>
              ))}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
