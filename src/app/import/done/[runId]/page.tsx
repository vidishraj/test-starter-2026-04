import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Import complete",
  robots: { index: false, follow: false },
};

type Params = { runId: string };

export default async function ImportDonePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { runId } = await params;
  const run = await prisma.importRun.findUnique({ where: { id: runId } });
  if (!run) notFound();

  const [tenantCount, unitCount, leaseCount, chargeCount, paymentCount, workOrderCount, buildingCount] =
    await Promise.all([
      prisma.tenant.count(),
      prisma.unit.count(),
      prisma.lease.count(),
      prisma.charge.count(),
      prisma.payment.count(),
      prisma.workOrder.count(),
      prisma.building.count(),
    ]);

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-xs uppercase tracking-[0.18em] text-accent font-medium">
          Import complete
        </p>
        <h1 className="mt-3 font-display text-5xl sm:text-6xl tracking-tight text-ink leading-[1.05]">
          Your Buildium data is live.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted leading-relaxed">
          Committed {run.committedAt
            ? new Date(run.committedAt).toLocaleString()
            : "just now"}
          . Your rent roll, AR aging, and natural-language query bar are
          ready.
        </p>

        <section className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat k="Buildings" v={buildingCount} />
          <Stat k="Units" v={unitCount} />
          <Stat k="Tenants" v={tenantCount} />
          <Stat k="Leases" v={leaseCount} />
          <Stat k="Charges" v={chargeCount} />
          <Stat k="Payments" v={paymentCount} />
          <Stat k="Work orders" v={workOrderCount} />
          <Stat k="Run id" v={run.id.slice(0, 10)} mono />
        </section>

        <section className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/dashboard"
            className="rounded-2xl border border-ink bg-ink text-white px-6 py-8 hover:bg-black transition-colors"
          >
            <p className="text-xs uppercase tracking-[0.14em] text-white/60">
              Next
            </p>
            <p className="mt-2 font-display text-2xl tracking-tight">
              Open your dashboard
            </p>
            <p className="mt-2 text-sm text-white/80">
              Rent roll, AR aging, expense chart, natural-language queries.
            </p>
          </Link>
          <Link
            href="/import"
            className="rounded-2xl border border-border bg-bg-elevated px-6 py-8 hover:border-ink/40 transition-colors"
          >
            <p className="text-xs uppercase tracking-[0.14em] text-muted-2">
              Or
            </p>
            <p className="mt-2 font-display text-2xl tracking-tight text-ink">
              Run another import
            </p>
            <p className="mt-2 text-sm text-muted">
              Idempotent — same data won&rsquo;t double-write. Use this for
              incremental syncs.
            </p>
          </Link>
        </section>
      </div>
    </main>
  );
}

function Stat({
  k,
  v,
  mono = false,
}: {
  k: string;
  v: number | string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-bg-elevated p-5">
      <p className="text-xs uppercase tracking-[0.12em] text-muted-2">{k}</p>
      <p
        className={`mt-2 ${mono ? "font-mono text-base" : "font-display text-3xl tracking-tight"} text-ink`}
      >
        {typeof v === "number" ? v.toLocaleString() : v}
      </p>
    </div>
  );
}
