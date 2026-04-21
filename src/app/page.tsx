import HeroSearch from "@/components/hero-search";

const EXAMPLE_CHIPS = [
  "Tech startup in Hudson Yards",
  "25 people in Midtown",
  "10,000 SF in FiDi",
  "Sublease near Penn Station",
  "Pre-built creative loft in SoHo",
  "Trophy tower with outdoor space",
];

const WEBSITE_JSONLD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Beyond the Space",
  url: "https://beyondthespace.example",
  description:
    "Chat-first NYC office search. Describe the space you need and let AI find matching listings.",
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate:
        "https://beyondthespace.example/search?q={search_term_string}",
    },
    "query-input": "required name=search_term_string",
  },
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        // Server-rendered. Known-safe structured data, not user-supplied.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(WEBSITE_JSONLD) }}
      />
      <main className="flex-1">
        <section className="mx-auto max-w-5xl px-6 pt-20 pb-24 sm:pt-28 sm:pb-32">
          <p className="text-xs uppercase tracking-[0.18em] text-accent font-medium">
            NYC office search · chat-first
          </p>
          <h1 className="font-display text-5xl sm:text-7xl leading-[1.02] tracking-tight mt-5 max-w-3xl">
            Describe the space.
            <br />
            <span className="italic text-ink">We&rsquo;ll find it.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted leading-relaxed">
            Skip the filters. Tell us what you&rsquo;re looking for in plain
            English — headcount, neighborhood, vibe, budget. Our search reads
            the intent and shows listings that actually match.
          </p>

          <div className="mt-12 max-w-3xl">
            <HeroSearch chips={EXAMPLE_CHIPS} />
          </div>

          <dl className="mt-20 grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-6 border-t border-border pt-10">
            <Stat k="25" v="Live listings" />
            <Stat k="11" v="NYC submarkets" />
            <Stat k="2,200–24,500" v="SF range" />
            <Stat k="< 2s" v="From prompt to results" />
          </dl>
        </section>
      </main>
    </>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="font-display text-2xl tracking-tight text-ink">{k}</dt>
      <dd className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-2">
        {v}
      </dd>
    </div>
  );
}
