type Props = {
  reply: string;
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

export default function AIBubble({ reply, notice, resultCount, filter }: Props) {
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
          <p className="text-[17px] leading-relaxed text-fg">{reply}</p>
          {notice && (
            <p className="mt-2 text-sm text-accent">{notice}</p>
          )}
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
