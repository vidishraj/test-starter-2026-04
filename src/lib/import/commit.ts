import { prisma } from "@/lib/db";
import type { ParsedImport } from "./buildium";

/**
 * Idempotent commit — every row upserts by `externalId` (or, for buildings,
 * by `normalizedName`). Running this twice against the same ParsedImport
 * writes once; re-running a month later with an updated export updates in
 * place instead of duplicating.
 *
 * Writes happen in FK order so foreign keys always resolve.
 */
export async function commitImport(parsed: ParsedImport): Promise<{
  buildings: number;
  tenants: number;
  units: number;
  leases: number;
  charges: number;
  payments: number;
  workOrders: number;
}> {
  // 1. Buildings — keyed by normalizedName
  const buildingIdByNormalized = new Map<string, string>();
  for (const b of parsed.buildings) {
    const row = await prisma.building.upsert({
      where: { normalizedName: b.normalizedName },
      update: { name: b.name },
      create: { name: b.name, normalizedName: b.normalizedName },
    });
    buildingIdByNormalized.set(b.normalizedName, row.id);
  }

  // 2. Tenants
  const tenantIdByExternalId = new Map<string, string>();
  for (const t of parsed.tenants) {
    const row = await prisma.tenant.upsert({
      where: { externalId: t.externalId },
      update: {
        firstName: t.firstName,
        lastName: t.lastName,
        email: t.email,
        emailNormalized: t.emailNormalized,
        phone: t.phone,
        dateOfBirth: t.dateOfBirth ? new Date(t.dateOfBirth) : null,
        status: t.status,
        notes: t.notes,
      },
      create: {
        externalId: t.externalId,
        firstName: t.firstName,
        lastName: t.lastName,
        email: t.email,
        emailNormalized: t.emailNormalized,
        phone: t.phone,
        dateOfBirth: t.dateOfBirth ? new Date(t.dateOfBirth) : null,
        status: t.status,
        notes: t.notes,
      },
    });
    tenantIdByExternalId.set(t.externalId, row.id);
  }

  // 3. Units
  const unitIdByExternalId = new Map<string, string>();
  for (const u of parsed.units) {
    const buildingId = buildingIdByNormalized.get(u.buildingNormalized);
    if (!buildingId) continue;
    const row = await prisma.unit.upsert({
      where: { externalId: u.externalId },
      update: {
        buildingId,
        label: u.label,
        bedrooms: u.bedrooms,
        bathrooms: u.bathrooms,
        squareFeet: u.squareFeet,
        monthlyRentTarget: u.monthlyRentTarget,
        status: u.status,
      },
      create: {
        externalId: u.externalId,
        buildingId,
        label: u.label,
        bedrooms: u.bedrooms,
        bathrooms: u.bathrooms,
        squareFeet: u.squareFeet,
        monthlyRentTarget: u.monthlyRentTarget,
        status: u.status,
      },
    });
    unitIdByExternalId.set(u.externalId, row.id);
  }

  // 4. Leases
  const leaseIdByExternalId = new Map<string, string>();
  for (const l of parsed.leases) {
    const unitId = unitIdByExternalId.get(l.unitExternalId);
    const tenantId = tenantIdByExternalId.get(l.tenantExternalId);
    if (!unitId || !tenantId) continue;
    const row = await prisma.lease.upsert({
      where: { externalId: l.externalId },
      update: {
        unitId,
        tenantId,
        startDate: new Date(l.startDate),
        endDate: l.endDate ? new Date(l.endDate) : null,
        monthlyRent: l.monthlyRent,
        securityDeposit: l.securityDeposit,
        status: l.status,
      },
      create: {
        externalId: l.externalId,
        unitId,
        tenantId,
        startDate: new Date(l.startDate),
        endDate: l.endDate ? new Date(l.endDate) : null,
        monthlyRent: l.monthlyRent,
        securityDeposit: l.securityDeposit,
        status: l.status,
      },
    });
    leaseIdByExternalId.set(l.externalId, row.id);
  }

  // 5. Charges
  let chargesWritten = 0;
  for (const c of parsed.charges) {
    const leaseId = leaseIdByExternalId.get(c.leaseExternalId);
    if (!leaseId) continue;
    await prisma.charge.upsert({
      where: { externalId: c.externalId },
      update: {
        leaseId,
        chargeDate: new Date(c.chargeDate),
        amount: c.amount,
        type: c.type,
        description: c.description,
      },
      create: {
        externalId: c.externalId,
        leaseId,
        chargeDate: new Date(c.chargeDate),
        amount: c.amount,
        type: c.type,
        description: c.description,
      },
    });
    chargesWritten++;
  }

  // 6. Payments
  let paymentsWritten = 0;
  for (const p of parsed.payments) {
    const leaseId = leaseIdByExternalId.get(p.leaseExternalId);
    if (!leaseId) continue;
    await prisma.payment.upsert({
      where: { externalId: p.externalId },
      update: {
        leaseId,
        paymentDate: new Date(p.paymentDate),
        amount: p.amount,
        method: p.method,
        notes: p.notes,
      },
      create: {
        externalId: p.externalId,
        leaseId,
        paymentDate: new Date(p.paymentDate),
        amount: p.amount,
        method: p.method,
        notes: p.notes,
      },
    });
    paymentsWritten++;
  }

  // 7. Work orders
  let workOrdersWritten = 0;
  for (const w of parsed.workOrders) {
    const unitId = unitIdByExternalId.get(w.unitExternalId);
    if (!unitId) continue;
    await prisma.workOrder.upsert({
      where: { externalId: w.externalId },
      update: {
        unitId,
        openedDate: new Date(w.openedDate),
        closedDate: w.closedDate ? new Date(w.closedDate) : null,
        status: w.status,
        category: w.category,
        description: w.description,
        vendorName: w.vendorName,
        cost: w.cost,
      },
      create: {
        externalId: w.externalId,
        unitId,
        openedDate: new Date(w.openedDate),
        closedDate: w.closedDate ? new Date(w.closedDate) : null,
        status: w.status,
        category: w.category,
        description: w.description,
        vendorName: w.vendorName,
        cost: w.cost,
      },
    });
    workOrdersWritten++;
  }

  return {
    buildings: parsed.buildings.length,
    tenants: tenantIdByExternalId.size,
    units: unitIdByExternalId.size,
    leases: leaseIdByExternalId.size,
    charges: chargesWritten,
    payments: paymentsWritten,
    workOrders: workOrdersWritten,
  };
}
