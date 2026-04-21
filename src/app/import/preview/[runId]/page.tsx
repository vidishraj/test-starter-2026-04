import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  type ParsedImport,
  type ImportWarning,
  type WarningKind,
} from "@/lib/import/buildium";
import { commitImportRun } from "../../actions";

export const metadata: Metadata = {
  title: "Preview import",
  robots: { index: false, follow: false },
};

type Params = { runId: string };

// Human-readable labels + one-line explanations for each warning kind.
// Order matters — this drives the render order of the Known issues list.
const KIND_LABELS: Record<WarningKind, { label: string; explain: string }> = {
  orphan_lease_ref: {
    label: "Charges / payments with unknown lease_id",
    explain:
      "Rows reference a lease that isn't in leases.csv. We'll skip these rather than invent leases. Fix in Buildium and re-import.",
  },
  orphan_tenant_ref: {
    label: "Leases with unknown tenant_id",
    explain:
      "Leases reference a tenant that isn't in tenants.csv. We'll skip these leases.",
  },
  orphan_unit_ref: {
    label: "Leases / work orders with unknown unit_id",
    explain:
      "Rows reference a unit that isn't in units.csv. Skipped.",
  },
  duplicate_email: {
    label: "Duplicate tenant emails",
    explain:
      "Two tenants share an email address. We'll import both, but only the first keeps the normalized email for dedup.",
  },
  invalid_email: {
    label: "Malformed emails",
    explain:
      "Not a valid email string. We'll preserve the raw value but skip email-based dedup for this tenant.",
  },
  invalid_date: {
    label: "Unparseable dates",
    explain:
      "The parser accepts MM/DD/YYYY and YYYY-MM-DD. Anything else falls through — we'll skip the row if the date is required.",
  },
  end_before_start: {
    label: "Leases where end_date is before start_date",
    explain:
      "Likely a data-entry error in Buildium. We'll import them as-is so you can review in the rent roll.",
  },
  overlapping_lease: {
    label: "Overlapping active leases on the same unit",
    explain:
      "Two or more active leases on the same unit. Common during mid-month tenant swaps — we keep both and flag for manual review.",
  },
  negative_amount: {
    label: "Negative charge / payment amounts",
    explain:
      "Often legitimate (credit memos, refunds). We import as-is; review before you run AR aging.",
  },
  zero_amount: {
    label: "Zero-amount payments",
    explain:
      "Usually reversal placeholders. Imported as-is so the audit trail stays intact.",
  },
  negative_square_feet: {
    label: "Negative square footage",
    explain:
      "Not physically possible. We store the unit with null sqft and flag it.",
  },
  null_rent_target: {
    label: "Missing monthly rent target",
    explain:
      "We store the unit with null rent and flag it — useful if rents are unset at import time.",
  },
  missing_required: {
    label: "Rows missing required fields",
    explain: "Skipped — we can't import a row without its primary key.",
  },
};

export default async function PreviewImportPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { runId } = await params;
  const run = await prisma.importRun.findUnique({ where: { id: runId } });
  if (!run) notFound();

  const parsed = JSON.parse(run.payload) as ParsedImport;
  const { stats } = parsed;

  // Group warnings by kind
  const byKind = new Map<WarningKind, ImportWarning[]>();
  for (const w of parsed.warnings) {
    if (!byKind.has(w.kind)) byKind.set(w.kind, []);
    byKind.get(w.kind)!.push(w);
  }
  const orderedKinds = (Object.keys(KIND_LABELS) as WarningKind[]).filter(
    (k) => byKind.has(k),
  );

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <nav className="text-xs uppercase tracking-[0.14em] text-muted-2">
          <Link href="/import" className="hover:text-fg">
            Import
          </Link>
          <span className="mx-2">/</span>
          <span className="text-muted">Preview</span>
        </nav>

        <div className="mt-6 flex items-end justify-between flex-wrap gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-accent font-medium">
              Preview · {run.source.replace("_", " ")}
            </p>
            <h1 className="mt-2 font-display text-4xl sm:text-5xl tracking-tight text-ink leading-[1.05]">
              Here&rsquo;s what we found.
            </h1>
            <p className="mt-3 text-muted">
              Parsed {new Date(run.startedAt).toLocaleString()}. Nothing has
              been written yet.
            </p>
          </div>
          {run.committedAt && (
            <span className="rounded-full bg-accent/10 text-accent border border-accent/30 px-3 py-1 text-xs uppercase tracking-[0.12em]">
              Already committed
            </span>
          )}
        </div>

        <section className="mt-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <EntityCard label="Tenants" stat={stats.tenants} />
          <EntityCard label="Units" stat={stats.units} />
          <EntityCard label="Leases" stat={stats.leases} />
          <EntityCard label="Charges" stat={stats.charges} />
          <EntityCard label="Payments" stat={stats.payments} />
          <EntityCard label="Work orders" stat={stats.workOrders} />
        </section>

        <section className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KeyFinding
            k="Buildings detected"
            v={String(stats.buildings)}
            hint="property-name variants collapsed"
          />
          <KeyFinding
            k="Duplicate emails"
            v={String(stats.duplicateEmailRows)}
            hint="tenants flagged, none dropped"
          />
          <KeyFinding
            k="Orphaned references"
            v={String(
              stats.orphanedRefs.lease +
                stats.orphanedRefs.tenant +
                stats.orphanedRefs.unit,
            )}
            hint={`${stats.orphanedRefs.lease} lease · ${stats.orphanedRefs.tenant} tenant · ${stats.orphanedRefs.unit} unit`}
          />
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl tracking-tight text-ink">
            Known issues
          </h2>
          <p className="mt-1 text-sm text-muted">
            Every warning below comes from a specific row. Nothing is silently
            dropped — rows we&rsquo;ll skip stay visible here.
          </p>
          <div className="mt-5 space-y-3">
            {orderedKinds.length === 0 ? (
              <p className="text-muted italic">
                No issues detected. Ship it.
              </p>
            ) : (
              orderedKinds.map((kind) => {
                const items = byKind.get(kind)!;
                return (
                  <WarningGroup
                    key={kind}
                    kind={kind}
                    label={KIND_LABELS[kind].label}
                    explain={KIND_LABELS[kind].explain}
                    items={items}
                  />
                );
              })
            )}
          </div>
        </section>

        <section className="mt-14 border-t border-border pt-8 flex items-center justify-between flex-wrap gap-4">
          <Link
            href="/import"
            className="text-sm text-muted hover:text-fg transition-colors"
          >
            ← Cancel and start over
          </Link>
          <form
            action={async () => {
              "use server";
              await commitImportRun(run.id);
            }}
          >
            <button
              type="submit"
              className="rounded-full bg-ink text-white px-6 py-3 text-sm font-medium hover:bg-black transition-colors"
            >
              Commit {stats.tenants.willImport + stats.units.willImport + stats.leases.willImport + stats.charges.willImport + stats.payments.willImport + stats.workOrders.willImport} rows
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

function EntityCard({
  label,
  stat,
}: {
  label: string;
  stat: { totalRows: number; willImport: number; willSkip: number; warnings: number };
}) {
  return (
    <div className="rounded-2xl border border-border bg-bg-elevated p-4">
      <p className="text-xs uppercase tracking-[0.12em] text-muted-2">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl tracking-tight text-ink">
        {stat.willImport.toLocaleString()}
      </p>
      <p className="text-xs text-muted mt-0.5">
        of {stat.totalRows.toLocaleString()}
      </p>
      <div className="mt-3 flex items-center gap-2 text-[11px] font-mono">
        {stat.willSkip > 0 && (
          <span className="text-accent">skip {stat.willSkip}</span>
        )}
        {stat.warnings > 0 && (
          <span className="text-muted">· {stat.warnings} warn</span>
        )}
      </div>
    </div>
  );
}

function KeyFinding({
  k,
  v,
  hint,
}: {
  k: string;
  v: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-bg-elevated p-5">
      <p className="text-xs uppercase tracking-[0.14em] text-muted-2">{k}</p>
      <p className="mt-2 font-display text-3xl tracking-tight text-ink">{v}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function WarningGroup({
  kind,
  label,
  explain,
  items,
}: {
  kind: WarningKind;
  label: string;
  explain: string;
  items: ImportWarning[];
}) {
  const sample = items.slice(0, 5);
  const rest = items.length - sample.length;
  return (
    <details className="group rounded-2xl border border-border bg-bg-elevated open:bg-bg">
      <summary className="cursor-pointer list-none px-5 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-fg">{label}</p>
          <p className="text-sm text-muted mt-0.5 truncate">{explain}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="rounded-full bg-accent/10 text-accent border border-accent/30 px-2.5 py-0.5 text-xs font-mono">
            {items.length}
          </span>
          <span className="text-muted-2 text-xs group-open:rotate-90 transition-transform">
            ▸
          </span>
        </div>
      </summary>
      <ul className="px-5 pb-4 space-y-2 border-t border-border pt-3 text-sm">
        {sample.map((w, i) => (
          <li key={`${kind}-${i}`} className="flex gap-3">
            {w.externalId && (
              <span className="font-mono text-xs text-muted-2 shrink-0 w-20">
                {w.externalId}
              </span>
            )}
            <span className="text-muted flex-1">{w.message}</span>
          </li>
        ))}
        {rest > 0 && (
          <li className="text-xs text-muted-2 italic">
            …and {rest.toLocaleString()} more like this.
          </li>
        )}
      </ul>
    </details>
  );
}
