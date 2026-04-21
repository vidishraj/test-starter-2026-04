import { getRentRoll } from "@/lib/dashboard/metrics";

/**
 * CSV export for the rent roll. Same columns the dashboard shows, plus
 * the raw numeric dollar amount for spreadsheet-friendliness.
 */
export async function GET(): Promise<Response> {
  const rows = await getRentRoll();
  const header = [
    "tenant",
    "tenant_email",
    "building",
    "unit",
    "monthly_rent_usd",
    "start_date",
    "end_date",
    "lease_status",
    "derived_status",
    "outstanding_usd",
    "oldest_unpaid_date",
    "lease_external_id",
  ];
  const lines = [header.map(csvCell).join(",")];

  for (const r of rows) {
    lines.push(
      [
        r.tenantName,
        r.tenantEmail ?? "",
        r.buildingName,
        r.unitLabel,
        (r.monthlyRent / 100).toFixed(2),
        r.startDate.toISOString().slice(0, 10),
        r.endDate ? r.endDate.toISOString().slice(0, 10) : "",
        r.leaseStatus,
        r.derivedStatus,
        (r.outstandingCents / 100).toFixed(2),
        r.oldestUnpaidDate ? r.oldestUnpaidDate.toISOString().slice(0, 10) : "",
        r.leaseExternalId,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  const body = lines.join("\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rent-roll-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function csvCell(v: string | number): string {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
