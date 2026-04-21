import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import ScrubHero from "./scrub-hero";
import {
  LISTINGS,
  findBySlug,
  formatSf,
  formatPricePerSf,
  formatAnnualRent,
  SUBMARKET_SLUGS,
  normalizeSubmarket,
} from "@/lib/listings";

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return LISTINGS.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const listing = findBySlug(slug);
  if (!listing) return { title: "Listing not found" };

  const title = `${listing.address} ${listing.unit} · ${listing.submarket}`;
  const description = `${formatSf(listing.sf)} SF ${listing.type} office space in ${listing.submarket}. ${listing.condition}, ${listing.availability} availability. ${formatPricePerSf(listing.pricePerSf)}.`;

  return {
    title,
    description,
    openGraph: {
      type: "article",
      title,
      description,
      images: [{ url: listing.heroImage }],
    },
    alternates: { canonical: `/listings/${listing.slug}` },
  };
}

// Fake but plausible transit data — spec allows synthetic for non-essentials.
const TRANSIT_BY_SUBMARKET: Record<string, { line: string; mins: number }[]> = {
  "Hudson Yards": [
    { line: "7 train — 34 St Hudson Yards", mins: 1 },
    { line: "A/C/E — Penn Station", mins: 8 },
    { line: "LIRR — Moynihan", mins: 9 },
  ],
  Flatiron: [
    { line: "N/Q/R/W — 23 St", mins: 2 },
    { line: "F/M — 23 St", mins: 4 },
    { line: "6 — 23 St", mins: 5 },
  ],
  FiDi: [
    { line: "4/5 — Wall St", mins: 2 },
    { line: "2/3 — Wall St", mins: 3 },
    { line: "R/W — Rector St", mins: 4 },
    { line: "Ferry — Pier 11", mins: 7 },
  ],
  "Midtown East": [
    { line: "6 — 51 St / Lexington", mins: 2 },
    { line: "E/M — 5 Av/53 St", mins: 4 },
  ],
  "Midtown West": [
    { line: "A/C/E — 50 St", mins: 2 },
    { line: "1 — 50 St", mins: 4 },
  ],
  SoHo: [
    { line: "6 — Spring St", mins: 3 },
    { line: "N/R/W — Prince St", mins: 4 },
  ],
  Tribeca: [
    { line: "1 — Franklin St", mins: 2 },
    { line: "A/C/E — Canal St", mins: 5 },
  ],
  "Penn Station": [
    { line: "1/2/3 — 34 St Penn", mins: 1 },
    { line: "A/C/E — 34 St Penn", mins: 2 },
    { line: "LIRR — Penn", mins: 3 },
  ],
  "Grand Central": [
    { line: "4/5/6/7 — Grand Central", mins: 1 },
    { line: "S — Times Sq Shuttle", mins: 2 },
    { line: "Metro-North — Grand Central", mins: 2 },
  ],
  Chelsea: [
    { line: "C/E — 23 St", mins: 3 },
    { line: "1 — 23 St", mins: 5 },
  ],
};

export default async function ListingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const listing = findBySlug(slug);
  if (!listing) notFound();

  const slides = [
    { src: listing.heroImage, label: "Hero", kind: "photo" as const },
    ...listing.photos.map((src, i) => ({
      src,
      label: `Photo ${i + 1}`,
      kind: "photo" as const,
    })),
    { src: listing.floorplan, label: "Floor plan", kind: "floorplan" as const },
  ];

  const transit =
    TRANSIT_BY_SUBMARKET[listing.submarket] ??
    TRANSIT_BY_SUBMARKET[listing.submarket.replace(" Area", "")] ??
    [];

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-6xl px-6 pt-6">
        <nav className="text-xs uppercase tracking-[0.14em] text-muted-2">
          <Link href="/" className="hover:text-fg">Home</Link>
          <span className="mx-2">/</span>
          <Link href="/office-space" className="hover:text-fg">Office space</Link>
          <span className="mx-2">/</span>
          {(() => {
            const canonical = normalizeSubmarket(listing.submarket);
            return canonical ? (
              <Link
                href={`/office-space/${SUBMARKET_SLUGS[canonical]}`}
                className="hover:text-fg"
              >
                {canonical}
              </Link>
            ) : (
              <span className="text-muted">{listing.submarket}</span>
            );
          })()}
        </nav>
      </div>

      <div className="mt-6">
        <ScrubHero
          slides={slides}
          address={listing.address}
          unit={listing.unit}
        />
      </div>

      <div className="mx-auto max-w-6xl px-6 py-12 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-12">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.16em] text-accent font-medium">
            {listing.submarket} · {listing.type}
          </p>
          <h1 className="mt-3 font-display text-4xl sm:text-5xl tracking-tight text-ink leading-[1.05]">
            {listing.address}
            <span className="block text-muted text-3xl sm:text-4xl mt-1">
              {listing.unit}
            </span>
          </h1>

          <p className="mt-6 text-lg text-muted leading-relaxed max-w-2xl">
            {listing.description}
          </p>

          <Section title="Space & Building">
            <DetailGrid
              items={[
                ["Square feet", `${formatSf(listing.sf)} SF`],
                ["Condition", listing.condition],
                ["Type", listing.type],
                ["Availability", listing.availability],
                ["Building class", listing.buildingClass],
                ["Year built", String(listing.yearBuilt)],
              ]}
            />
          </Section>

          <Section title="Features">
            <div className="flex flex-wrap gap-2">
              {listing.features.map((f) => (
                <span
                  key={f}
                  className="rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-sm text-muted"
                >
                  {f}
                </span>
              ))}
            </div>
          </Section>

          <Section title="Floor plan">
            <div className="rounded-2xl border border-border bg-bg-elevated p-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={listing.floorplan}
                alt={`Floor plan for ${listing.address} ${listing.unit}`}
                width={1200}
                height={800}
                loading="lazy"
                decoding="async"
                sizes="(min-width: 1024px) 700px, 100vw"
                className="w-full h-auto max-h-[520px] object-contain"
              />
            </div>
          </Section>

          <Section title="Transit & Commute">
            {transit.length === 0 ? (
              <p className="text-muted">Transit details available on request.</p>
            ) : (
              <ul className="divide-y divide-border rounded-2xl border border-border bg-bg-elevated overflow-hidden">
                {transit.map((t) => (
                  <li
                    key={t.line}
                    className="flex items-center justify-between px-5 py-4"
                  >
                    <span className="text-fg">{t.line}</span>
                    <span className="font-mono text-sm text-muted">
                      {t.mins} min walk
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <aside className="lg:sticky lg:top-8 self-start">
          <div className="rounded-2xl border border-border bg-bg-elevated p-6">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-2">
              Pricing
            </p>
            <p className="mt-3 font-display text-4xl tracking-tight text-ink">
              {formatPricePerSf(listing.pricePerSf)}
            </p>
            <p className="mt-1 text-sm text-muted">
              {formatAnnualRent(listing)} · {formatSf(listing.sf)} SF
            </p>

            <dl className="mt-6 space-y-3 text-sm border-t border-border pt-5">
              <Row k="Availability" v={listing.availability} />
              <Row k="Type" v={listing.type} />
              <Row k="Condition" v={listing.condition} />
              <Row k="Building class" v={listing.buildingClass} />
            </dl>
          </div>

          <form
            className="mt-5 rounded-2xl border border-border bg-bg-elevated p-6"
            action="#"
            method="post"
          >
            <p className="font-display text-xl tracking-tight text-ink">
              Contact the broker
            </p>
            <p className="mt-1 text-sm text-muted">
              We&rsquo;ll introduce you within a business day.
            </p>
            <div className="mt-4 space-y-3">
              <input
                type="text"
                name="name"
                placeholder="Your name"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm focus:outline-none focus:border-ink"
                required
              />
              <input
                type="email"
                name="email"
                placeholder="Work email"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm focus:outline-none focus:border-ink"
                required
              />
              <textarea
                name="message"
                rows={3}
                placeholder="Headcount, move-in timing, anything we should know…"
                className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-sm focus:outline-none focus:border-ink resize-none"
              />
              <button
                type="submit"
                className="w-full rounded-full bg-ink text-white py-3 text-sm font-medium hover:bg-black transition-colors"
              >
                Request a tour
              </button>
            </div>
          </form>
        </aside>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12 border-t border-border pt-8">
      <h2 className="font-display text-2xl tracking-tight text-ink mb-5">
        {title}
      </h2>
      {children}
    </section>
  );
}

function DetailGrid({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-5">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs uppercase tracking-[0.14em] text-muted-2">
            {k}
          </dt>
          <dd className="mt-1 text-[15px] text-fg capitalize">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted">{k}</dt>
      <dd className="text-fg capitalize">{v}</dd>
    </div>
  );
}
