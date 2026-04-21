import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  formatDate,
  formatDollars,
  formatDollarsPrecise,
} from "@/lib/dashboard/metrics";

export const metadata: Metadata = {
  title: "Tenant detail",
  robots: { index: false, follow: false },
};

type Params = { id: string };

export default async function TenantPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;

  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      leases: {
        include: {
          unit: { include: { building: true } },
          charges: { orderBy: { chargeDate: "desc" } },
          payments: { orderBy: { paymentDate: "desc" } },
        },
        orderBy: { startDate: "desc" },
      },
    },
  });
  if (!tenant) notFound();

  // Running balance: merge charges + payments on date, oldest first.
  type Event = {
    date: Date;
    kind: "charge" | "payment";
    amount: number;
    label: string;
    leaseExternalId: string;
  };
  const events: Event[] = [];
  for (const l of tenant.leases) {
    for (const c of l.charges) {
      events.push({
        date: c.chargeDate,
        kind: "charge",
        amount: c.amount,
        label: c.description ?? c.type,
        leaseExternalId: l.externalId,
      });
    }
    for (const p of l.payments) {
      events.push({
        date: p.paymentDate,
        kind: "payment",
        amount: p.amount,
        label: p.notes ?? p.method ?? "payment",
        leaseExternalId: l.externalId,
      });
    }
  }
  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  let balance = 0;
  const eventRows = events.map((e) => {
    balance += e.kind === "charge" ? e.amount : -e.amount;
    return { ...e, balance };
  });
  const reversed = [...eventRows].reverse();

  const totalCharged = events
    .filter((e) => e.kind === "charge")
    .reduce((s, e) => s + e.amount, 0);
  const totalPaid = events
    .filter((e) => e.kind === "payment")
    .reduce((s, e) => s + e.amount, 0);

  return (
    <main className="flex-1 bg-bg">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <nav className="text-xs uppercase tracking-[0.14em] text-muted-2">
          <Link href="/dashboard" className="hover:text-fg">
            Dashboard
          </Link>
          <span className="mx-2">/</span>
          <span className="text-muted">Tenant</span>
        </nav>

        <div className="mt-6">
          <p className="text-xs uppercase tracking-[0.18em] text-accent font-medium">
            Tenant · {tenant.status}
          </p>
          <h1 className="mt-2 font-display text-4xl sm:text-5xl tracking-tight text-ink leading-[1.05]">
            {tenant.firstName} {tenant.lastName}
          </h1>
          <p className="mt-2 text-muted">
            {tenant.email ?? "no email"} · {tenant.phone ?? "no phone"} ·{" "}
            <span className="font-mono text-muted-2">{tenant.externalId}</span>
          </p>
        </div>

        <section className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPI label="Total charged" value={formatDollars(totalCharged)} />
          <KPI label="Total paid" value={formatDollars(totalPaid)} />
          <KPI
            label="Outstanding"
            value={formatDollars(Math.max(0, totalCharged - totalPaid))}
            accent={totalCharged - totalPaid > 0}
          />
        </section>

        <section className="mt-10">
          <h2 className="font-display text-2xl tracking-tight text-ink">
            Leases
          </h2>
          <div className="mt-4 space-y-3">
            {tenant.leases.map((l) => (
              <div
                key={l.id}
                className="rounded-2xl border border-border bg-bg-elevated p-5"
              >
                <div className="flex items-start justify-between flex-wrap gap-3">
                  <div>
                    <p className="font-medium text-fg">
                      {l.unit.building.name} · {l.unit.label}
                    </p>
                    <p className="text-sm text-muted">
                      {formatDate(l.startDate)} →{" "}
                      {l.endDate ? formatDate(l.endDate) : "open"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm tabular-nums">
                      {formatDollars(l.monthlyRent)}/mo
                    </p>
                    <p className="text-xs text-muted-2 capitalize">
                      {l.status}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="font-display text-2xl tracking-tight text-ink">
            Payment history
          </h2>
          <p className="mt-1 text-sm text-muted">
            Running balance, most recent first. Charges increase the balance;
            payments decrease it.
          </p>
          <div className="mt-5 rounded-2xl border border-border bg-bg-elevated overflow-hidden">
            {reversed.length === 0 ? (
              <p className="p-8 text-muted italic">
                No charges or payments on file for this tenant.
              </p>
            ) : (
              <div className="max-h-[520px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-bg sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.12em] text-muted-2 font-medium">
                        Date
                      </th>
                      <th className="px-4 py-3 text-left text-xs uppercase tracking-[0.12em] text-muted-2 font-medium">
                        Event
                      </th>
                      <th className="px-4 py-3 text-right text-xs uppercase tracking-[0.12em] text-muted-2 font-medium">
                        Amount
                      </th>
                      <th className="px-4 py-3 text-right text-xs uppercase tracking-[0.12em] text-muted-2 font-medium">
                        Balance
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {reversed.map((e, i) => (
                      <tr
                        key={i}
                        className="border-b border-border last:border-0 hover:bg-bg"
                      >
                        <td className="px-4 py-3 tabular-nums text-muted">
                          {e.date.toISOString().slice(0, 10)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                              e.kind === "charge"
                                ? "bg-accent/10 text-accent"
                                : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {e.kind}
                          </span>
                          <span className="text-fg">{e.label}</span>
                          <span className="ml-2 font-mono text-xs text-muted-2">
                            {e.leaseExternalId}
                          </span>
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono tabular-nums ${
                            e.kind === "charge" ? "text-accent" : "text-emerald-700"
                          }`}
                        >
                          {e.kind === "payment" ? "−" : "+"}
                          {formatDollarsPrecise(e.amount)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-fg">
                          {formatDollarsPrecise(e.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function KPI({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
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
    </div>
  );
}
