import JSZip from "jszip";
import Papa from "papaparse";

/**
 * Buildium CSV import — parse + validate + cross-reference.
 *
 * The pipeline is explicitly non-destructive: bad rows produce warnings,
 * not silent drops. The caller renders those warnings in a preview screen
 * so the property manager sees exactly what will and won't make it into
 * the database before they click Commit.
 *
 * Outputs are addressed by the source system's externalId (T0001, U027,
 * L0003, etc.). The commit step looks up by externalId, which is how
 * re-running the same import is idempotent.
 */

// ─── Warning taxonomy ────────────────────────────────────────────────

export type WarningKind =
  | "orphan_lease_ref"
  | "orphan_tenant_ref"
  | "orphan_unit_ref"
  | "invalid_date"
  | "invalid_email"
  | "duplicate_email"
  | "negative_amount"
  | "zero_amount"
  | "negative_square_feet"
  | "null_rent_target"
  | "end_before_start"
  | "overlapping_lease"
  | "missing_required";

export type ImportWarning = {
  entity:
    | "tenant"
    | "unit"
    | "building"
    | "lease"
    | "charge"
    | "payment"
    | "work_order";
  externalId?: string;
  kind: WarningKind;
  field?: string;
  message: string;
};

// ─── Staged entity shapes (what goes into ImportRun.payload) ─────────

export type StagedBuilding = {
  name: string;
  normalizedName: string;
};

export type StagedTenant = {
  externalId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  emailNormalized: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  status: string;
  notes: string | null;
};

export type StagedUnit = {
  externalId: string;
  buildingNormalized: string;
  label: string;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  monthlyRentTarget: number | null;
  status: string;
};

export type StagedLease = {
  externalId: string;
  unitExternalId: string;
  tenantExternalId: string;
  startDate: string;
  endDate: string | null;
  monthlyRent: number;
  securityDeposit: number | null;
  status: string;
};

export type StagedCharge = {
  externalId: string;
  leaseExternalId: string;
  chargeDate: string;
  amount: number;
  type: string;
  description: string | null;
};

export type StagedPayment = {
  externalId: string;
  leaseExternalId: string;
  paymentDate: string;
  amount: number;
  method: string | null;
  notes: string | null;
};

export type StagedWorkOrder = {
  externalId: string;
  unitExternalId: string;
  openedDate: string;
  closedDate: string | null;
  status: string;
  category: string;
  description: string;
  vendorName: string;
  cost: number | null;
};

export type EntityStat = {
  totalRows: number;
  willImport: number;
  willSkip: number;
  warnings: number;
};

export type ParsedImport = {
  tenants: StagedTenant[];
  buildings: StagedBuilding[];
  units: StagedUnit[];
  leases: StagedLease[];
  charges: StagedCharge[];
  payments: StagedPayment[];
  workOrders: StagedWorkOrder[];
  warnings: ImportWarning[];
  stats: {
    tenants: EntityStat;
    units: EntityStat;
    leases: EntityStat;
    charges: EntityStat;
    payments: EntityStat;
    workOrders: EntityStat;
    buildings: number;
    duplicateEmailRows: number;
    orphanedRefs: { lease: number; tenant: number; unit: number };
  };
};

// ─── Coercion helpers ────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Accepts MM/DD/YYYY or YYYY-MM-DD. Returns ISO date string or null. */
export function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  // YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`;
  // MM/DD/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const mm = us[1].padStart(2, "0");
    const dd = us[2].padStart(2, "0");
    return `${us[3]}-${mm}-${dd}T00:00:00.000Z`;
  }
  return null;
}

/** Dollars (as string or number) → integer cents. */
export function toCents(raw: string | number | undefined): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100);
}

export function normalizeEmail(raw: string | undefined): {
  email: string | null;
  normalized: string | null;
  valid: boolean;
} {
  if (!raw) return { email: null, normalized: null, valid: false };
  const trimmed = raw.trim();
  if (!trimmed) return { email: null, normalized: null, valid: false };
  const valid = EMAIL_RE.test(trimmed);
  return {
    email: trimmed,
    normalized: valid ? trimmed.toLowerCase() : null,
    valid,
  };
}

/**
 * "1234 Elm St" / "1234 Elm Street" / "1234 Elm St." all collapse to
 * "1234 elm st". Also handles "Ave/Avenue", "Rd/Road", "Blvd/Boulevard".
 */
export function normalizeBuildingName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\./g, " ")
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\s+/g, " ")
    .trim();
}

function toInt(raw: string | undefined): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = parseInt(String(raw), 10);
  return Number.isNaN(n) ? null : n;
}

function toFloat(raw: string | undefined): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = parseFloat(String(raw));
  return Number.isNaN(n) ? null : n;
}

function parseCsv<T>(text: string): T[] {
  const result = Papa.parse<T>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  });
  return result.data;
}

// ─── Per-file parsers ────────────────────────────────────────────────

type RawTenant = {
  tenant_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  status: string;
  notes: string;
};

type RawUnit = {
  unit_id: string;
  property_name: string;
  unit_number: string;
  bedrooms: string;
  bathrooms: string;
  square_feet: string;
  monthly_rent_target: string;
  status: string;
};

type RawLease = {
  lease_id: string;
  tenant_id: string;
  unit_id: string;
  start_date: string;
  end_date: string;
  monthly_rent: string;
  security_deposit: string;
  status: string;
};

type RawCharge = {
  charge_id: string;
  lease_id: string;
  charge_date: string;
  amount: string;
  type: string;
  description: string;
};

type RawPayment = {
  payment_id: string;
  lease_id: string;
  payment_date: string;
  amount: string;
  method: string;
  notes: string;
};

type RawWorkOrder = {
  work_order_id: string;
  unit_id: string;
  opened_date: string;
  closed_date: string;
  status: string;
  category: string;
  description: string;
  vendor_name: string;
  cost: string;
};

// ─── Main entry points ───────────────────────────────────────────────

export async function parseBuildiumZip(
  buffer: ArrayBuffer | Buffer | Uint8Array,
): Promise<ParsedImport> {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (name: string) => {
    const file = zip.file(name);
    if (!file) throw new Error(`Missing ${name} in zip`);
    return file.async("string");
  };

  const [tenantsCsv, unitsCsv, leasesCsv, chargesCsv, paymentsCsv, workOrdersCsv] =
    await Promise.all([
      read("tenants.csv"),
      read("units.csv"),
      read("leases.csv"),
      read("charges.csv"),
      read("payments.csv"),
      read("work_orders.csv"),
    ]);

  return parseBuildiumCsvs({
    tenants: tenantsCsv,
    units: unitsCsv,
    leases: leasesCsv,
    charges: chargesCsv,
    payments: paymentsCsv,
    workOrders: workOrdersCsv,
  });
}

export function parseBuildiumCsvs(files: {
  tenants: string;
  units: string;
  leases: string;
  charges: string;
  payments: string;
  workOrders: string;
}): ParsedImport {
  const warnings: ImportWarning[] = [];

  // ─── Tenants ───────────────────────────────────────────────────────
  const rawTenants = parseCsv<RawTenant>(files.tenants);
  const tenantsByExternalId = new Map<string, StagedTenant>();
  const emailSeen = new Map<string, string>(); // normalized email → first externalId
  let duplicateEmailRows = 0;

  for (const r of rawTenants) {
    if (!r.tenant_id || !r.first_name || !r.last_name) {
      warnings.push({
        entity: "tenant",
        externalId: r.tenant_id,
        kind: "missing_required",
        message: `Tenant row missing required field(s)`,
      });
      continue;
    }
    const dob = parseDate(r.date_of_birth);
    if (r.date_of_birth && !dob) {
      warnings.push({
        entity: "tenant",
        externalId: r.tenant_id,
        kind: "invalid_date",
        field: "date_of_birth",
        message: `Could not parse date_of_birth "${r.date_of_birth}"`,
      });
    }
    const { email, normalized, valid } = normalizeEmail(r.email);
    if (r.email && !valid) {
      warnings.push({
        entity: "tenant",
        externalId: r.tenant_id,
        kind: "invalid_email",
        field: "email",
        message: `Malformed email "${r.email}" — keeping the raw string, skipping dedup`,
      });
    }

    let finalEmailNormalized = normalized;
    if (normalized && emailSeen.has(normalized)) {
      duplicateEmailRows++;
      finalEmailNormalized = null; // leave null on the dup to avoid uniq collision
      warnings.push({
        entity: "tenant",
        externalId: r.tenant_id,
        kind: "duplicate_email",
        field: "email",
        message: `Email "${normalized}" already seen on ${emailSeen.get(normalized)} — importing this tenant without the normalized email`,
      });
    } else if (normalized) {
      emailSeen.set(normalized, r.tenant_id);
    }

    tenantsByExternalId.set(r.tenant_id, {
      externalId: r.tenant_id,
      firstName: r.first_name,
      lastName: r.last_name,
      email,
      emailNormalized: finalEmailNormalized,
      phone: r.phone || null,
      dateOfBirth: dob,
      status: r.status || "unknown",
      notes: r.notes || null,
    });
  }

  // ─── Buildings & Units ─────────────────────────────────────────────
  const rawUnits = parseCsv<RawUnit>(files.units);
  const buildingsByNormalized = new Map<string, StagedBuilding>();
  const unitsByExternalId = new Map<string, StagedUnit>();

  for (const r of rawUnits) {
    if (!r.unit_id || !r.property_name || !r.unit_number) {
      warnings.push({
        entity: "unit",
        externalId: r.unit_id,
        kind: "missing_required",
        message: `Unit row missing required field(s)`,
      });
      continue;
    }
    const normalized = normalizeBuildingName(r.property_name);
    if (!buildingsByNormalized.has(normalized)) {
      buildingsByNormalized.set(normalized, {
        name: r.property_name,
        normalizedName: normalized,
      });
    }

    const sf = toInt(r.square_feet);
    let sqftOut: number | null = sf;
    if (sf !== null && sf < 0) {
      sqftOut = null;
      warnings.push({
        entity: "unit",
        externalId: r.unit_id,
        kind: "negative_square_feet",
        field: "square_feet",
        message: `Negative square_feet (${sf}) — storing as null`,
      });
    }

    const rentCents = toCents(r.monthly_rent_target);
    if (rentCents === null && r.monthly_rent_target) {
      warnings.push({
        entity: "unit",
        externalId: r.unit_id,
        kind: "null_rent_target",
        field: "monthly_rent_target",
        message: `Unparseable monthly_rent_target — storing as null`,
      });
    } else if (!r.monthly_rent_target) {
      warnings.push({
        entity: "unit",
        externalId: r.unit_id,
        kind: "null_rent_target",
        field: "monthly_rent_target",
        message: `Null monthly_rent_target — storing as null`,
      });
    }

    unitsByExternalId.set(r.unit_id, {
      externalId: r.unit_id,
      buildingNormalized: normalized,
      label: r.unit_number,
      bedrooms: toInt(r.bedrooms),
      bathrooms: toFloat(r.bathrooms),
      squareFeet: sqftOut,
      monthlyRentTarget: rentCents,
      status: r.status || "unknown",
    });
  }

  // ─── Leases ────────────────────────────────────────────────────────
  const rawLeases = parseCsv<RawLease>(files.leases);
  const leasesByExternalId = new Map<string, StagedLease>();

  for (const r of rawLeases) {
    if (!r.lease_id) continue;

    const startDate = parseDate(r.start_date);
    const endDate = parseDate(r.end_date);
    if (r.start_date && !startDate) {
      warnings.push({
        entity: "lease",
        externalId: r.lease_id,
        kind: "invalid_date",
        field: "start_date",
        message: `Unparseable start_date "${r.start_date}" — skipping lease`,
      });
      continue;
    }
    if (r.end_date && !endDate) {
      warnings.push({
        entity: "lease",
        externalId: r.lease_id,
        kind: "invalid_date",
        field: "end_date",
        message: `Unparseable end_date "${r.end_date}" — storing as null`,
      });
    }
    if (startDate && endDate && endDate < startDate) {
      warnings.push({
        entity: "lease",
        externalId: r.lease_id,
        kind: "end_before_start",
        message: `end_date (${r.end_date}) is before start_date (${r.start_date}) — importing as-is, flagging`,
      });
    }

    if (!unitsByExternalId.has(r.unit_id)) {
      warnings.push({
        entity: "lease",
        externalId: r.lease_id,
        kind: "orphan_unit_ref",
        field: "unit_id",
        message: `References unknown unit_id "${r.unit_id}" — skipping lease`,
      });
      continue;
    }
    if (!tenantsByExternalId.has(r.tenant_id)) {
      warnings.push({
        entity: "lease",
        externalId: r.lease_id,
        kind: "orphan_tenant_ref",
        field: "tenant_id",
        message: `References unknown tenant_id "${r.tenant_id}" — skipping lease`,
      });
      continue;
    }

    const rent = toCents(r.monthly_rent);
    if (rent === null) {
      warnings.push({
        entity: "lease",
        externalId: r.lease_id,
        kind: "missing_required",
        field: "monthly_rent",
        message: `Unparseable monthly_rent — skipping lease`,
      });
      continue;
    }

    leasesByExternalId.set(r.lease_id, {
      externalId: r.lease_id,
      unitExternalId: r.unit_id,
      tenantExternalId: r.tenant_id,
      startDate: startDate!,
      endDate: endDate,
      monthlyRent: rent,
      securityDeposit: toCents(r.security_deposit),
      status: r.status || "unknown",
    });
  }

  // Overlapping active leases on the same unit — informational, not blocking.
  {
    const activeByUnit = new Map<string, StagedLease[]>();
    for (const l of leasesByExternalId.values()) {
      if (l.status === "ended") continue;
      const list = activeByUnit.get(l.unitExternalId) ?? [];
      list.push(l);
      activeByUnit.set(l.unitExternalId, list);
    }
    for (const [unitId, leases] of activeByUnit) {
      if (leases.length > 1) {
        for (const l of leases) {
          warnings.push({
            entity: "lease",
            externalId: l.externalId,
            kind: "overlapping_lease",
            message: `Unit ${unitId} has ${leases.length} active leases — keeping all, flag for manual review`,
          });
        }
      }
    }
  }

  // ─── Charges ───────────────────────────────────────────────────────
  const rawCharges = parseCsv<RawCharge>(files.charges);
  const charges: StagedCharge[] = [];
  for (const r of rawCharges) {
    if (!r.charge_id) continue;
    if (!leasesByExternalId.has(r.lease_id)) {
      warnings.push({
        entity: "charge",
        externalId: r.charge_id,
        kind: "orphan_lease_ref",
        field: "lease_id",
        message: `References unknown lease_id "${r.lease_id}" — skipping charge`,
      });
      continue;
    }
    const date = parseDate(r.charge_date);
    if (!date) {
      warnings.push({
        entity: "charge",
        externalId: r.charge_id,
        kind: "invalid_date",
        field: "charge_date",
        message: `Unparseable charge_date "${r.charge_date}" — skipping charge`,
      });
      continue;
    }
    const amount = toCents(r.amount);
    if (amount === null) {
      warnings.push({
        entity: "charge",
        externalId: r.charge_id,
        kind: "missing_required",
        field: "amount",
        message: `Unparseable amount — skipping charge`,
      });
      continue;
    }
    if (amount < 0) {
      warnings.push({
        entity: "charge",
        externalId: r.charge_id,
        kind: "negative_amount",
        message: `Negative amount (${amount / 100}) — importing as-is (could be a credit memo)`,
      });
    }
    charges.push({
      externalId: r.charge_id,
      leaseExternalId: r.lease_id,
      chargeDate: date,
      amount,
      type: r.type || "unknown",
      description: r.description || null,
    });
  }

  // ─── Payments ──────────────────────────────────────────────────────
  const rawPayments = parseCsv<RawPayment>(files.payments);
  const payments: StagedPayment[] = [];
  for (const r of rawPayments) {
    if (!r.payment_id) continue;
    if (!leasesByExternalId.has(r.lease_id)) {
      warnings.push({
        entity: "payment",
        externalId: r.payment_id,
        kind: "orphan_lease_ref",
        field: "lease_id",
        message: `References unknown lease_id "${r.lease_id}" — skipping payment`,
      });
      continue;
    }
    const date = parseDate(r.payment_date);
    if (!date) {
      warnings.push({
        entity: "payment",
        externalId: r.payment_id,
        kind: "invalid_date",
        field: "payment_date",
        message: `Unparseable payment_date — skipping payment`,
      });
      continue;
    }
    const amount = toCents(r.amount);
    if (amount === null) {
      warnings.push({
        entity: "payment",
        externalId: r.payment_id,
        kind: "missing_required",
        field: "amount",
        message: `Unparseable amount — skipping payment`,
      });
      continue;
    }
    if (amount === 0) {
      warnings.push({
        entity: "payment",
        externalId: r.payment_id,
        kind: "zero_amount",
        message: `Zero-amount payment — importing as-is (often a reversal placeholder)`,
      });
    }
    payments.push({
      externalId: r.payment_id,
      leaseExternalId: r.lease_id,
      paymentDate: date,
      amount,
      method: r.method || null,
      notes: r.notes || null,
    });
  }

  // ─── Work orders ───────────────────────────────────────────────────
  const rawWorkOrders = parseCsv<RawWorkOrder>(files.workOrders);
  const workOrders: StagedWorkOrder[] = [];
  for (const r of rawWorkOrders) {
    if (!r.work_order_id) continue;
    if (!unitsByExternalId.has(r.unit_id)) {
      warnings.push({
        entity: "work_order",
        externalId: r.work_order_id,
        kind: "orphan_unit_ref",
        field: "unit_id",
        message: `References unknown unit_id "${r.unit_id}" — skipping work order`,
      });
      continue;
    }
    const opened = parseDate(r.opened_date);
    const closed = parseDate(r.closed_date);
    if (!opened) {
      warnings.push({
        entity: "work_order",
        externalId: r.work_order_id,
        kind: "invalid_date",
        field: "opened_date",
        message: `Unparseable opened_date — skipping work order`,
      });
      continue;
    }
    const cost = toCents(r.cost);
    if (cost !== null && cost < 0) {
      warnings.push({
        entity: "work_order",
        externalId: r.work_order_id,
        kind: "negative_amount",
        field: "cost",
        message: `Negative cost — importing as-is (credit or reversal)`,
      });
    }
    workOrders.push({
      externalId: r.work_order_id,
      unitExternalId: r.unit_id,
      openedDate: opened,
      closedDate: closed,
      status: r.status || "unknown",
      category: r.category || "unknown",
      description: r.description || "",
      vendorName: r.vendor_name || "",
      cost,
    });
  }

  // ─── Aggregate stats ───────────────────────────────────────────────
  const orphanedRefs = {
    lease: warnings.filter(
      (w) => w.kind === "orphan_lease_ref",
    ).length,
    tenant: warnings.filter(
      (w) => w.kind === "orphan_tenant_ref",
    ).length,
    unit: warnings.filter((w) => w.kind === "orphan_unit_ref").length,
  };

  const countEntity = <T>(
    rawCount: number,
    imported: T[],
    entityName: ImportWarning["entity"],
  ): EntityStat => ({
    totalRows: rawCount,
    willImport: imported.length,
    willSkip: rawCount - imported.length,
    warnings: warnings.filter((w) => w.entity === entityName).length,
  });

  return {
    tenants: [...tenantsByExternalId.values()],
    buildings: [...buildingsByNormalized.values()],
    units: [...unitsByExternalId.values()],
    leases: [...leasesByExternalId.values()],
    charges,
    payments,
    workOrders,
    warnings,
    stats: {
      tenants: countEntity(
        rawTenants.length,
        [...tenantsByExternalId.values()],
        "tenant",
      ),
      units: countEntity(
        rawUnits.length,
        [...unitsByExternalId.values()],
        "unit",
      ),
      leases: countEntity(
        rawLeases.length,
        [...leasesByExternalId.values()],
        "lease",
      ),
      charges: countEntity(rawCharges.length, charges, "charge"),
      payments: countEntity(rawPayments.length, payments, "payment"),
      workOrders: countEntity(rawWorkOrders.length, workOrders, "work_order"),
      buildings: buildingsByNormalized.size,
      duplicateEmailRows,
      orphanedRefs,
    },
  };
}
