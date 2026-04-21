import Link from "next/link";
import {
  type ARAgingSummary,
  type ARBucket,
  formatDollars,
} from "@/lib/dashboard/metrics";

const BUCKETS: ARBucket[] = ["0-30", "31-60", "61-90", "90+"];

const BUCKET_TONES: Record<ARBucket, { bar: string; text: string }> = {
  "0-30": { bar: "bg-emerald-500", text: "text-emerald-700" },
  "31-60": { bar: "bg-amber-400", text: "text-amber-700" },
  "61-90": { bar: "bg-orange-500", text: "text-orange-700" },
  "90+": { bar: "bg-accent", text: "text-accent" },
};

export default function ARAging({ summary }: { summary: ARAgingSummary }) {
  const { rows, totals, totalOutstanding } = summary;
  const max = Math.max(...BUCKETS.map((b) => totals[b]), 1);

  return (
    <div className="rounded-2xl border border-border bg-bg-elevated overflow-hidden">
      <div className="p-6 border-b border-border">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-2">
              Accounts receivable
            </p>
            <p className="mt-1 font-display text-3xl tracking-tight text-ink">
              {formatDollars(totalOutstanding)}
            </p>
            <p className="text-xs text-muted mt-1">
              across {rows.length} tenant{rows.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-4 gap-4">
          {BUCKETS.map((b) => {
            const pct = (totals[b] / max) * 100;
            return (
              <div key={b}>
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-xs uppercase tracking-[0.12em] text-muted-2">
                    {b} days
                  </span>
                </div>
                <div className="h-20 flex items-end">
                  <div
                    className={`w-full rounded-t ${BUCKET_TONES[b].bar} transition-all`}
                    style={{ height: `${Math.max(pct, 2)}%` }}
                    aria-hidden
                  />
                </div>
                <p
                  className={`mt-2 font-mono text-sm tabular-nums ${BUCKET_TONES[b].text}`}
                >
                  {formatDollars(totals[b])}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="max-h-[420px] overflow-y-auto">
        {rows.length === 0 ? (
          <p className="p-8 text-muted italic">
            No outstanding balances. Every tenant is current.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-bg sticky top-0">
                <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.12em] text-muted-2 font-medium">
                  Tenant
                </th>
                <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.12em] text-muted-2 font-medium">
                  Age
                </th>
                <th className="px-4 py-3 text-right text-xs uppercase tracking-[0.12em] text-muted-2 font-medium">
                  Outstanding
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 50).map((r) => (
                <tr
                  key={r.tenantId}
                  className="border-b border-border last:border-0 hover:bg-bg transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/tenants/${r.tenantId}`}
                      className="text-ink hover:underline"
                    >
                      {r.tenantName}
                    </Link>
                    {r.tenantEmail && (
                      <div className="text-xs text-muted-2">{r.tenantEmail}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${
                        r.bucket === "90+"
                          ? "bg-accent/10 text-accent border-accent/30"
                          : r.bucket === "61-90"
                            ? "bg-orange-50 text-orange-700 border-orange-200"
                            : r.bucket === "31-60"
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200"
                      }`}
                    >
                      {r.bucket} days
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-fg">
                    {formatDollars(r.outstandingCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
