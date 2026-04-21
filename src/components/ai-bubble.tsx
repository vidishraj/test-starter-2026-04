import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  notice?: string;
  resultCount: number;
  filter: {
    submarket?: string | null;
    sfMin?: number | null;
    sfMax?: number | null;
    features?: string[] | null;
    subleaseOrDirect?: string | null;
  };
};

/**
 * Presentational shell. The reply text is passed in as `children` so the
 * caller can wrap it in a Suspense boundary — cards render on filter
 * resolution, the reply streams in underneath.
 */
export default function AIBubble({
  children,
  notice,
  resultCount,
  filter,
}: Props) {
  const chips: string[] = [];
  if (filter.submarket) chips.push(filter.submarket);
  if (filter.sfMin || filter.sfMax) {
    const lo = filter.sfMin ? filter.sfMin.toLocaleString() : "any";
    const hi = filter.sfMax ? filter.sfMax.toLocaleString() : "any";
    chips.push(`${lo}–${hi} SF`);
  }
  if (filter.subleaseOrDirect && filter.subleaseOrDirect !== "any") {
    chips.push(filter.subleaseOrDirect);
  }
  if (filter.features && filter.features.length > 0) {
    for (const f of filter.features.slice(0, 3)) chips.push(f);
  }

  return (
    <div className="rounded-3xl border border-border bg-bg-elevated px-6 py-5 sm:px-8 sm:py-6">
      <div className="flex items-start gap-4">
        <div className="shrink-0 h-9 w-9 rounded-full bg-ink text-white flex items-center justify-center font-display text-[15px]">
          B
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[17px] leading-relaxed text-fg">{children}</div>
          {notice && <p className="mt-2 text-sm text-accent">{notice}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-muted-2 uppercase tracking-[0.12em]">
              {resultCount} {resultCount === 1 ? "match" : "matches"}
            </span>
            {chips.map((c) => (
              <span
                key={c}
                className="rounded-full border border-border bg-bg px-2.5 py-1 text-xs text-muted"
              >
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function BubbleSkeleton() {
  return (
    <div className="rounded-3xl border border-border bg-bg-elevated px-6 py-5 sm:px-8 sm:py-6">
      <div className="flex items-start gap-4">
        <div className="shrink-0 h-9 w-9 rounded-full bg-ink/60 animate-pulse" />
        <div className="flex-1">
          <div className="h-4 w-3/4 rounded-full bg-border animate-pulse" />
          <div className="mt-3 h-3 w-1/2 rounded-full bg-border animate-pulse" />
        </div>
      </div>
    </div>
  );
}

export function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 text-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-2 animate-pulse [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-muted-2 animate-pulse [animation-delay:200ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-muted-2 animate-pulse [animation-delay:400ms]" />
    </span>
  );
}
