import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AIBubble from "@/components/ai-bubble";
import ListingCard from "@/components/listing-card";
import HeroSearch from "@/components/hero-search";
import { LISTINGS, applyFilter } from "@/lib/listings";
import { parseSearch } from "@/lib/ai/search";

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

  const parse = await parseSearch(query);
  let results = applyFilter(LISTINGS, parse.filter);

  // Graceful degradation: if the LLM zeroed out on submarket or filter,
  // drop back to all listings and annotate the bubble. Spec calls this out.
  let notice = parse.notice;
  if (results.length === 0) {
    results = LISTINGS;
    notice =
      notice ??
      "No exact matches — showing the full catalog so you can refine from here.";
  }

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
          <AIBubble
            reply={parse.reply}
            notice={notice}
            resultCount={results.length}
            filter={parse.filter}
          />
        </div>

        <section className="mt-10">
          <div className="flex items-end justify-between mb-5">
            <h2 className="font-display text-xl tracking-tight text-ink">
              {results.length === LISTINGS.length
                ? "All available listings"
                : "Matching listings"}
            </h2>
            <p className="text-sm text-muted">
              {results.length} of {LISTINGS.length}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {results.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
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
