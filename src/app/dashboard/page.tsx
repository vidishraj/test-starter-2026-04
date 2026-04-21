import type { Metadata } from "next";
import Link from "next/link";
import {
  getARAging,
  getExpenseSeries,
  getKPIs,
  getRentRoll,
  formatDollars,
  formatPercent,
} from "@/lib/dashboard/metrics";
import RentRollTable from "./rent-roll-table";
import ARAging from "./ar-aging";
import ExpenseChart from "./expense-chart";
import NLQuery from "./nl-query";

export const metadata: Metadata = {
  title: "Portfolio dashboard",
  description:
    "Rent roll, AR aging, operating expenses, and natural-language portfolio queries.",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  // Run every aggregation in parallel — they all hit the DB independently.
  const [kpis, rentRoll, arAging, expenses] = await Promise.all([
    getKPIs(),
    getRentRoll(),
    getARAging(),
    getExpenseSeries(),
  ]);

  if (kpis.activeLeases === 0) {
    return <EmptyState />;
  }

  const rentRollForClient = rentRoll.map((r) => ({
    ...r,
    startDateIso: r.startDate.toISOString().slice(0, 10),
    endDateIso: r.endDate ? r.endDate.toISOString().slice(0, 10) : null,
    startDate: undefined as unknown,
    endDate: undefined as unknown,
    oldestUnpaidDate: undefined as unknown,
    // strip Date objects — they don't serialize across the client boundary
  })) as unknown as Array<
    Omit<(typeof rentRoll)[number], "startDate" | "endDate" | "oldestUnpaidDate"> & {
      startDateIso: string;
      endDateIso: string | null;
    }
  >;

  return (
    <main className="flex-1 bg-bg">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-accent font-medium">
              Property management · dashboard
            </p>
            <h1 className="mt-2 font-display text-4xl sm:text-5xl tracking-tight text-ink leading-[1.05]">
              Portfolio overview
            </h1>
            <p className="mt-2 text-muted">
              {kpis.activeLeases} active lease{kpis.activeLeases === 1 ? "" : "s"}
              {" · "}
              {kpis.totalUnits} unit{kpis.totalUnits === 1 ? "" : "s"}
              {" · "}
              {formatPercent(kpis.occupancyPct)} occupied
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/dashboard/rent-roll.csv"
              download
              className="rounded-full border border-border bg-bg-elevated px-4 py-2 text-sm text-muted hover:text-fg hover:border-ink transition-colors"
            >
              Export rent roll ↓
            </a>
            <Link
              href="/import"
              className="rounded-full border border-border bg-bg-elevated px-4 py-2 text-sm text-muted hover:text-fg hover:border-ink transition-colors"
            >
              Run an import
            </Link>
          </div>
        </div>

        <section className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPI
            label="Monthly rent roll"
            value={formatDollars(kpis.monthlyRentRollCents)}
            hint={`${kpis.activeLeases} active`}
          />
          <KPI
            label="Occupancy"
            value={formatPercent(kpis.occupancyPct)}
            hint={`${kpis.totalUnits} total units`}
          />
          <KPI
            label="Open AR"
            value={formatDollars(kpis.openARCents)}
            hint={`${arAging.rows.length} tenants with balances`}
            accent
          />
          <KPI
            label="Open work orders"
            value={String(kpis.openWorkOrders)}
            hint="unresolved maintenance"
          />
        </section>

        <div className="mt-8">
          <NLQuery />
        </div>

        <section className="mt-8 grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3">
            <div className="flex items-end justify-between mb-4">
              <h2 className="font-display text-2xl tracking-tight text-ink">
                Rent roll
              </h2>
              <p className="text-xs uppercase tracking-[0.12em] text-muted-2">
                Click any column header to sort
              </p>
            </div>
            <RentRollTable rows={rentRollForClient} />
          </div>
          <div className="lg:col-span-2">
            <div className="flex items-end justify-between mb-4">
              <h2 className="font-display text-2xl tracking-tight text-ink">
                AR aging
              </h2>
              <p className="text-xs uppercase tracking-[0.12em] text-muted-2">
                Click a tenant for payment history
              </p>
            </div>
            <ARAging summary={arAging} />
          </div>
        </section>

        <section className="mt-10">
          <div className="flex items-end justify-between mb-4">
            <h2 className="font-display text-2xl tracking-tight text-ink">
              Operating expenses
            </h2>
          </div>
          <ExpenseChart series={expenses} />
        </section>
      </div>
    </main>
  );
}

function KPI({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-bg-elevated p-5">
      <p className="text-xs uppercase tracking-[0.14em] text-muted-2">
        {label}
      </p>
      <p
        className={`mt-2 font-display text-3xl tracking-tight ${accent ? "text-accent" : "text-ink"}`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <main className="flex-1 bg-bg">
      <div className="mx-auto max-w-3xl px-6 py-20 text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-accent font-medium">
          No data yet
        </p>
        <h1 className="mt-3 font-display text-5xl tracking-tight text-ink leading-[1.05]">
          Run your first import.
        </h1>
        <p className="mt-4 text-muted">
          Upload your Buildium export or try the sample to populate the
          dashboard.
        </p>
        <Link
          href="/import"
          className="mt-8 inline-block rounded-full bg-ink text-white px-6 py-3 text-sm font-medium hover:bg-black transition-colors"
        >
          Go to import
        </Link>
      </div>
    </main>
  );
}
