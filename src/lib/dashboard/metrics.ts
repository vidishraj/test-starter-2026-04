import { prisma } from "@/lib/db";

/**
 * Dashboard aggregations. Every function here is a pure read against
 * Prisma — no mutations, no LLM calls. Shared between the dashboard
 * pages and the CSV export route.
 */

export type RentRollRow = {
  leaseId: string;
  leaseExternalId: string;
  tenantId: string;
  tenantName: string;
  tenantEmail: string | null;
  unitLabel: string;
  buildingName: string;
  monthlyRent: number;
  startDate: Date;
  endDate: Date | null;
  securityDeposit: number | null;
  leaseStatus: string;
  derivedStatus: "current" | "late" | "notice-given" | "ended";
  outstandingCents: number;
  oldestUnpaidDate: Date | null;
};

export async function getRentRoll(): Promise<RentRollRow[]> {
  const leases = await prisma.lease.findMany({
    where: { status: { notIn: ["ended", "terminated"] } },
    include: {
      tenant: true,
      unit: { include: { building: true } },
      charges: true,
      payments: true,
    },
    orderBy: [{ unit: { building: { name: "asc" } } }, { unit: { label: "asc" } }],
  });

  const today = new Date();
  const noticeWindowDays = 60;

  return leases.map((l) => {
    const chargesTotal = l.charges.reduce((s, c) => s + c.amount, 0);
    const paymentsTotal = l.payments.reduce((s, p) => s + p.amount, 0);
    const outstandingCents = chargesTotal - paymentsTotal;

    // Oldest unpaid-charge date = approximate age of receivable. We walk
    // charges oldest-first, applying payments greedily until we run out.
    const sortedCharges = [...l.charges].sort(
      (a, b) => a.chargeDate.getTime() - b.chargeDate.getTime(),
    );
    let remainingPayments = paymentsTotal;
    let oldestUnpaidDate: Date | null = null;
    for (const c of sortedCharges) {
      if (remainingPayments >= c.amount) {
        remainingPayments -= c.amount;
      } else {
        oldestUnpaidDate = c.chargeDate;
        break;
      }
    }

    let derivedStatus: RentRollRow["derivedStatus"] = "current";
    if (l.status === "ended" || l.status === "terminated") {
      derivedStatus = "ended";
    } else if (
      l.endDate &&
      l.endDate.getTime() - today.getTime() < noticeWindowDays * 86400_000 &&
      l.endDate > today
    ) {
      derivedStatus = "notice-given";
    }
    if (outstandingCents > 0 && oldestUnpaidDate) {
      const ageDays =
        (today.getTime() - oldestUnpaidDate.getTime()) / 86400_000;
      if (ageDays > 10) derivedStatus = "late";
    }

    return {
      leaseId: l.id,
      leaseExternalId: l.externalId,
      tenantId: l.tenantId,
      tenantName: `${l.tenant.firstName} ${l.tenant.lastName}`,
      tenantEmail: l.tenant.email,
      unitLabel: l.unit.label,
      buildingName: l.unit.building.name,
      monthlyRent: l.monthlyRent,
      startDate: l.startDate,
      endDate: l.endDate,
      securityDeposit: l.securityDeposit,
      leaseStatus: l.status,
      derivedStatus,
      outstandingCents,
      oldestUnpaidDate,
    };
  });
}

export type ARBucket = "0-30" | "31-60" | "61-90" | "90+";

export type ARAgingRow = {
  tenantId: string;
  tenantName: string;
  tenantEmail: string | null;
  outstandingCents: number;
  bucket: ARBucket;
  oldestUnpaidDate: Date;
  leaseExternalIds: string[];
};

export type ARAgingSummary = {
  rows: ARAgingRow[];
  totals: Record<ARBucket, number>;
  totalOutstanding: number;
};

export async function getARAging(): Promise<ARAgingSummary> {
  const rows = await getRentRoll();
  const today = new Date();

  // Group by tenant so one tenant with two leases shows as one line item.
  const byTenant = new Map<
    string,
    {
      tenantId: string;
      tenantName: string;
      tenantEmail: string | null;
      outstandingCents: number;
      oldestUnpaidDate: Date | null;
      leaseExternalIds: string[];
    }
  >();

  for (const r of rows) {
    if (r.outstandingCents <= 0 || !r.oldestUnpaidDate) continue;
    const existing = byTenant.get(r.tenantId);
    if (existing) {
      existing.outstandingCents += r.outstandingCents;
      existing.leaseExternalIds.push(r.leaseExternalId);
      if (r.oldestUnpaidDate && (!existing.oldestUnpaidDate || r.oldestUnpaidDate < existing.oldestUnpaidDate)) {
        existing.oldestUnpaidDate = r.oldestUnpaidDate;
      }
    } else {
      byTenant.set(r.tenantId, {
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        tenantEmail: r.tenantEmail,
        outstandingCents: r.outstandingCents,
        oldestUnpaidDate: r.oldestUnpaidDate,
        leaseExternalIds: [r.leaseExternalId],
      });
    }
  }

  const totals: Record<ARBucket, number> = {
    "0-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };

  const arRows: ARAgingRow[] = [];
  for (const v of byTenant.values()) {
    if (!v.oldestUnpaidDate) continue;
    const ageDays =
      (today.getTime() - v.oldestUnpaidDate.getTime()) / 86400_000;
    const bucket: ARBucket =
      ageDays <= 30 ? "0-30" : ageDays <= 60 ? "31-60" : ageDays <= 90 ? "61-90" : "90+";
    totals[bucket] += v.outstandingCents;
    arRows.push({
      tenantId: v.tenantId,
      tenantName: v.tenantName,
      tenantEmail: v.tenantEmail,
      outstandingCents: v.outstandingCents,
      bucket,
      oldestUnpaidDate: v.oldestUnpaidDate,
      leaseExternalIds: v.leaseExternalIds,
    });
  }

  arRows.sort((a, b) => b.outstandingCents - a.outstandingCents);
  const totalOutstanding = Object.values(totals).reduce((s, v) => s + v, 0);

  return { rows: arRows, totals, totalOutstanding };
}

export type KPIs = {
  monthlyRentRollCents: number;
  activeLeases: number;
  totalUnits: number;
  occupancyPct: number;
  openARCents: number;
  openWorkOrders: number;
};

export async function getKPIs(): Promise<KPIs> {
  const [activeLeases, totalUnits, openWO, aging] = await Promise.all([
    prisma.lease.findMany({
      where: { status: { notIn: ["ended", "terminated"] } },
      select: { monthlyRent: true, unitId: true },
    }),
    prisma.unit.count(),
    prisma.workOrder.count({ where: { status: "open" } }),
    getARAging(),
  ]);

  const monthlyRentRollCents = activeLeases.reduce(
    (s, l) => s + l.monthlyRent,
    0,
  );
  const occupiedUnits = new Set(activeLeases.map((l) => l.unitId)).size;
  const occupancyPct = totalUnits === 0 ? 0 : (occupiedUnits / totalUnits) * 100;

  return {
    monthlyRentRollCents,
    activeLeases: activeLeases.length,
    totalUnits,
    occupancyPct,
    openARCents: aging.totalOutstanding,
    openWorkOrders: openWO,
  };
}

// ─── Expense chart ───────────────────────────────────────────────────

export type ExpenseCategory =
  | "maintenance"
  | "hvac"
  | "plumbing"
  | "electrical"
  | "pest_control"
  | "cleaning"
  | "landscaping"
  | "utilities"
  | "taxes"
  | "insurance"
  | "management";

export type ExpenseMonthRow = {
  month: string; // "YYYY-MM"
  label: string; // "Feb"
  year: number;
  byCategory: Record<string, number>; // category → cents
  total: number;
};

const REAL_CATEGORIES: ExpenseCategory[] = [
  "maintenance",
  "hvac",
  "plumbing",
  "electrical",
  "pest_control",
  "cleaning",
  "landscaping",
];

const SYNTH_CATEGORIES: ExpenseCategory[] = [
  "utilities",
  "taxes",
  "insurance",
  "management",
];

/**
 * Aggregate real work-order costs by month/category for the last 12 months,
 * and synthesize the opex categories that the source data doesn't cover
 * (utilities, taxes, insurance, management). Synthetic fill is deterministic
 * — seeded off the month index — so the chart is stable across reloads.
 */
export async function getExpenseSeries(): Promise<ExpenseMonthRow[]> {
  const today = new Date();
  const months: ExpenseMonthRow[] = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push({
      month,
      label: d.toLocaleString("en-US", { month: "short" }),
      year: d.getFullYear(),
      byCategory: {},
      total: 0,
    });
  }

  const from = new Date(months[0].month + "-01T00:00:00.000Z");
  const to = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  const workOrders = await prisma.workOrder.findMany({
    where: {
      openedDate: { gte: from, lt: to },
      cost: { not: null },
    },
    select: { openedDate: true, category: true, cost: true },
  });

  for (const w of workOrders) {
    if (w.cost === null || w.cost < 0) continue;
    const key = `${w.openedDate.getFullYear()}-${String(w.openedDate.getMonth() + 1).padStart(2, "0")}`;
    const row = months.find((m) => m.month === key);
    if (!row) continue;
    const cat = normalizeExpenseCategory(w.category);
    row.byCategory[cat] = (row.byCategory[cat] ?? 0) + w.cost;
  }

  // Synthetic fill — deterministic per month index so renders are stable.
  const SYNTH_BASELINE: Record<string, [number, number]> = {
    utilities: [280_000, 80_000], // $2,800 ± $800 per month per portfolio
    taxes: [420_000, 20_000],
    insurance: [180_000, 20_000],
    management: [250_000, 40_000],
  };

  months.forEach((row, i) => {
    for (const [cat, [base, spread]] of Object.entries(SYNTH_BASELINE)) {
      const wiggle = ((i * 9301 + 49297) % 233280) / 233280 - 0.5;
      row.byCategory[cat] = Math.round(base + wiggle * 2 * spread);
    }
    row.total = Object.values(row.byCategory).reduce((s, v) => s + v, 0);
  });

  return months;
}

function normalizeExpenseCategory(raw: string): string {
  const k = raw.toLowerCase().trim();
  if (REAL_CATEGORIES.includes(k as ExpenseCategory)) return k;
  if (k === "general") return "maintenance";
  return "maintenance";
}

export const EXPENSE_CATEGORY_ORDER: string[] = [
  ...SYNTH_CATEGORIES,
  ...REAL_CATEGORIES,
];

export const EXPENSE_CATEGORY_COLORS: Record<string, string> = {
  taxes: "#0f1e3a",
  insurance: "#1f3a5f",
  management: "#3a5a85",
  utilities: "#5a7ea8",
  maintenance: "#b9501f",
  hvac: "#d17a4a",
  plumbing: "#e29e75",
  electrical: "#c6a04f",
  pest_control: "#8a7d3f",
  cleaning: "#789d6b",
  landscaping: "#5e8a68",
};

// ─── Formatters ──────────────────────────────────────────────────────

export function formatDollars(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function formatDollarsPrecise(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
