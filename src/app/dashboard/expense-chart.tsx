import {
  EXPENSE_CATEGORY_COLORS,
  EXPENSE_CATEGORY_ORDER,
  formatDollars,
  type ExpenseMonthRow,
} from "@/lib/dashboard/metrics";

/**
 * Stacked-bar chart, hand-rolled SVG. No chart lib — 25 lines of geometry
 * gives full control over ticks, labels, tooltips, and bundle size.
 */
export default function ExpenseChart({ series }: { series: ExpenseMonthRow[] }) {
  const chartW = 820;
  const chartH = 280;
  const pad = { t: 16, r: 16, b: 36, l: 56 };
  const plotW = chartW - pad.l - pad.r;
  const plotH = chartH - pad.t - pad.b;

  const max = Math.max(...series.map((m) => m.total), 1);
  const yTicks = 4;
  const niceMax = roundUpToNice(max);
  const barGap = 8;
  const barW = (plotW - barGap * (series.length - 1)) / series.length;

  const categoriesInUse = EXPENSE_CATEGORY_ORDER.filter((c) =>
    series.some((m) => (m.byCategory[c] ?? 0) > 0),
  );

  const totalYear = series.reduce((s, m) => s + m.total, 0);

  return (
    <div className="rounded-2xl border border-border bg-bg-elevated p-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted-2">
            Operating expenses · trailing 12 months
          </p>
          <p className="mt-1 font-display text-3xl tracking-tight text-ink">
            {formatDollars(totalYear)}
          </p>
          <p className="text-xs text-muted mt-1">
            synthetic fill for utilities / taxes / insurance / management
            (Buildium export doesn&rsquo;t cover these)
          </p>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <svg
          viewBox={`0 0 ${chartW} ${chartH}`}
          width="100%"
          role="img"
          aria-label="Stacked bar chart of monthly operating expenses by category"
          className="max-w-full"
        >
          {/* Y grid + ticks */}
          {Array.from({ length: yTicks + 1 }).map((_, i) => {
            const y = pad.t + (plotH * i) / yTicks;
            const value = Math.round(niceMax * (1 - i / yTicks));
            return (
              <g key={`y-${i}`}>
                <line
                  x1={pad.l}
                  x2={chartW - pad.r}
                  y1={y}
                  y2={y}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={pad.l - 8}
                  y={y}
                  fontSize="10"
                  fill="var(--muted-2)"
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  ${(value / 100 / 1000).toFixed(0)}k
                </text>
              </g>
            );
          })}

          {/* Stacked bars */}
          {series.map((m, i) => {
            const x = pad.l + i * (barW + barGap);
            let yCursor = pad.t + plotH;
            return (
              <g key={m.month}>
                {EXPENSE_CATEGORY_ORDER.map((cat) => {
                  const v = m.byCategory[cat] ?? 0;
                  if (v <= 0) return null;
                  const h = (v / niceMax) * plotH;
                  yCursor -= h;
                  return (
                    <rect
                      key={cat}
                      x={x}
                      y={yCursor}
                      width={barW}
                      height={h}
                      fill={EXPENSE_CATEGORY_COLORS[cat] ?? "#666"}
                    >
                      <title>{`${m.label} · ${cat} · ${formatDollars(v)}`}</title>
                    </rect>
                  );
                })}
                <text
                  x={x + barW / 2}
                  y={chartH - pad.b + 16}
                  fontSize="11"
                  fill="var(--muted)"
                  textAnchor="middle"
                >
                  {m.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        {categoriesInUse.map((c) => (
          <div key={c} className="flex items-center gap-2 text-xs">
            <span
              className="h-3 w-3 rounded-sm"
              style={{ background: EXPENSE_CATEGORY_COLORS[c] ?? "#666" }}
              aria-hidden
            />
            <span className="text-muted capitalize">{c.replace("_", " ")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function roundUpToNice(n: number): number {
  if (n === 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  const norm = n / mag;
  let nice: number;
  if (norm <= 1) nice = 1;
  else if (norm <= 2) nice = 2;
  else if (norm <= 5) nice = 5;
  else nice = 10;
  return nice * mag;
}
