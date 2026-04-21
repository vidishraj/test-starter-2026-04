import Link from "next/link";
import type { Listing } from "@/lib/listings";
import { formatSf, formatPricePerSf } from "@/lib/listings";

export default function ListingCard({
  listing,
  priority = false,
}: {
  listing: Listing;
  priority?: boolean;
}) {
  const badgeTone =
    listing.type === "sublease"
      ? "bg-accent/10 text-accent border-accent/30"
      : "bg-ink/5 text-ink border-ink/20";

  return (
    <Link
      href={`/listings/${listing.slug}`}
      className="group block rounded-2xl border border-border bg-bg-elevated overflow-hidden hover:border-ink/40 transition-colors"
    >
      <div className="aspect-[4/3] bg-border relative overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={listing.heroImage}
          alt={`${listing.address} ${listing.unit}`}
          width={800}
          height={600}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
        />
        <span
          className={`absolute top-3 left-3 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.1em] ${badgeTone}`}
        >
          {listing.type}
        </span>
      </div>
      <div className="p-5">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-xs uppercase tracking-[0.14em] text-muted-2">
            {listing.submarket}
          </p>
          <p className="text-xs font-mono text-muted">
            {listing.buildingClass} · {listing.yearBuilt}
          </p>
        </div>
        <h3 className="mt-2 font-display text-xl tracking-tight text-ink">
          {listing.address}
        </h3>
        <p className="text-sm text-muted">{listing.unit}</p>
        <div className="mt-4 flex items-baseline justify-between border-t border-border pt-4">
          <div>
            <p className="text-lg font-medium text-fg">{formatSf(listing.sf)} SF</p>
            <p className="text-xs text-muted-2">{listing.condition}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-medium text-fg">
              {formatPricePerSf(listing.pricePerSf)}
            </p>
            <p className="text-xs text-muted-2">{listing.availability}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function ListingCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-bg-elevated overflow-hidden">
      <div className="aspect-[4/3] bg-border animate-pulse" />
      <div className="p-5 space-y-3">
        <div className="h-3 w-1/3 rounded-full bg-border animate-pulse" />
        <div className="h-5 w-3/4 rounded-full bg-border animate-pulse" />
        <div className="h-3 w-1/2 rounded-full bg-border animate-pulse" />
      </div>
    </div>
  );
}
