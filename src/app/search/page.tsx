import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import AIBubble, { BubbleSkeleton, TypingDots } from "@/components/ai-bubble";
import ListingCard, { ListingCardSkeleton } from "@/components/listing-card";
import HeroSearch from "@/components/hero-search";
import { LISTINGS, applyFilter } from "@/lib/listings";
import { streamSearch, type StreamedSearch } from "@/lib/ai/search";

type SearchParams = { q?: string };

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const title = query ? `Results for "${query}"` : "Search NYC office space";
  return {
    title,
    description: query
      ? `AI-parsed NYC office listings for "${query}".`
      : "Describe your ideal NYC office space. Our AI turns your query into a structured search.",
    robots: query ? { index: false, follow: true } : undefined,
  };
}

const REFINE_CHIPS = [
  "smaller, under 5,000 SF",
  "only sublease",
  "with outdoor space",
  "in Flatiron instead",
];

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  if (!query) redirect("/");

  // Fire the stream once; both Suspense boundaries below await different
  // resolution points on the same underlying request.
  const stream = streamSearch(query);

  return (
    <main className="flex-1 bg-bg">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <p className="text-xs uppercase tracking-[0.16em] text-muted-2">
          Your search
        </p>
        <h1 className="mt-2 font-display text-3xl sm:text-4xl tracking-tight text-ink max-w-3xl">
          &ldquo;{query}&rdquo;
        </h1>

        <div className="mt-8">
          <Suspense fallback={<BubbleSkeleton />}>
            <ResolvedBubble stream={stream} />
          </Suspense>
        </div>

        <section className="mt-10">
          <Suspense fallback={<CardsHeadingSkeleton />}>
            <ResolvedCardsHeading stream={stream} />
          </Suspense>
          <Suspense fallback={<CardsGridSkeleton />}>
            <ResolvedCards stream={stream} />
          </Suspense>
        </section>

        <section className="mt-16 border-t border-border pt-10">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-2">
            Refine your search
          </p>
          <p className="mt-1 font-display text-xl tracking-tight text-ink">
            Tell me what to change.
          </p>
          <div className="mt-5 max-w-2xl">
            <HeroSearch
              chips={REFINE_CHIPS}
              initialQuery=""
              size="compact"
              placeholder="Refine — e.g. 'same but under 5,000 SF and sublease only'"
            />
          </div>
        </section>
      </div>
    </main>
  );
}

async function ResolvedBubble({ stream }: { stream: StreamedSearch }) {
  const resolved = await stream.filterPromise;
  const matches = applyFilter(LISTINGS, resolved.filter);
  const count = matches.length > 0 ? matches.length : LISTINGS.length;

  return (
    <AIBubble
      filter={resolved.filter}
      notice={resolved.notice}
      resultCount={count}
    >
      <Suspense fallback={<TypingDots />}>
        <ResolvedReply replyPromise={stream.replyPromise} />
      </Suspense>
    </AIBubble>
  );
}

async function ResolvedReply({
  replyPromise,
}: {
  replyPromise: Promise<string>;
}) {
  const reply = await replyPromise;
  return <p>{reply}</p>;
}

async function ResolvedCardsHeading({ stream }: { stream: StreamedSearch }) {
  const resolved = await stream.filterPromise;
  const matches = applyFilter(LISTINGS, resolved.filter);
  const showingAll = matches.length === 0;
  const count = showingAll ? LISTINGS.length : matches.length;
  return (
    <div className="flex items-end justify-between mb-5">
      <h2 className="font-display text-xl tracking-tight text-ink">
        {showingAll ? "All available listings" : "Matching listings"}
      </h2>
      <p className="text-sm text-muted">
        {count} of {LISTINGS.length}
      </p>
    </div>
  );
}

async function ResolvedCards({ stream }: { stream: StreamedSearch }) {
  const resolved = await stream.filterPromise;
  let results = applyFilter(LISTINGS, resolved.filter);
  // Graceful degradation: empty filter result → fall back to full catalog.
  if (results.length === 0) results = LISTINGS;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {results.map((l, i) => (
        <ListingCard key={l.id} listing={l} priority={i < 3} />
      ))}
    </div>
  );
}

function CardsHeadingSkeleton() {
  return (
    <div className="flex items-end justify-between mb-5">
      <div className="h-6 w-48 rounded-full bg-border animate-pulse" />
      <div className="h-3 w-16 rounded-full bg-border animate-pulse" />
    </div>
  );
}

function CardsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <ListingCardSkeleton key={i} />
      ))}
    </div>
  );
}
