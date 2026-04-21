"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { RentRollRow } from "@/lib/dashboard/metrics";

type SortKey =
  | "tenantName"
  | "buildingName"
  | "unitLabel"
  | "monthlyRent"
  | "startDate"
  | "endDate"
  | "derivedStatus"
  | "outstandingCents";

type Row = Omit<RentRollRow, "startDate" | "endDate" | "oldestUnpaidDate"> & {
  startDateIso: string;
  endDateIso: string | null;
};

export default function RentRollTable({ rows }: { rows: Row[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("buildingName");
  const [asc, setAsc] = useState(true);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      let av: string | number | null = null;
      let bv: string | number | null = null;
      switch (sortKey) {
        case "tenantName":
          av = a.tenantName;
          bv = b.tenantName;
          break;
        case "buildingName":
          av = a.buildingName;
          bv = b.buildingName;
          break;
        case "unitLabel":
          av = a.unitLabel;
          bv = b.unitLabel;
          break;
        case "monthlyRent":
          av = a.monthlyRent;
          bv = b.monthlyRent;
          break;
        case "startDate":
          av = a.startDateIso;
          bv = b.startDateIso;
          break;
        case "endDate":
          av = a.endDateIso ?? "";
          bv = b.endDateIso ?? "";
          break;
        case "derivedStatus":
          av = a.derivedStatus;
          bv = b.derivedStatus;
          break;
        case "outstandingCents":
          av = a.outstandingCents;
          bv = b.outstandingCents;
          break;
      }
      if (av === bv) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av < bv ? -1 : 1) * (asc ? 1 : -1);
    });
    return copy;
  }, [rows, sortKey, asc]);

  const toggle = (k: SortKey) => {
    if (k === sortKey) setAsc(!asc);
    else {
      setSortKey(k);
      setAsc(true);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-bg-elevated overflow-hidden">
      <div className="overflow-auto max-h-[640px]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border bg-bg">
              <Th onClick={() => toggle("tenantName")} active={sortKey === "tenantName"} asc={asc}>Tenant</Th>
              <Th onClick={() => toggle("buildingName")} active={sortKey === "buildingName"} asc={asc}>Building</Th>
              <Th onClick={() => toggle("unitLabel")} active={sortKey === "unitLabel"} asc={asc}>Unit</Th>
              <Th onClick={() => toggle("monthlyRent")} active={sortKey === "monthlyRent"} asc={asc} align="right">Rent</Th>
              <Th onClick={() => toggle("startDate")} active={sortKey === "startDate"} asc={asc}>Start</Th>
              <Th onClick={() => toggle("endDate")} active={sortKey === "endDate"} asc={asc}>End</Th>
              <Th onClick={() => toggle("derivedStatus")} active={sortKey === "derivedStatus"} asc={asc}>Status</Th>
              <Th onClick={() => toggle("outstandingCents")} active={sortKey === "outstandingCents"} asc={asc} align="right">Outstanding</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.leaseId} className="border-b border-border last:border-0 hover:bg-bg transition-colors">
                <td className="px-3 py-3 whitespace-nowrap">
                  <Link
                    href={`/dashboard/tenants/${r.tenantId}`}
                    className="text-ink hover:underline"
                  >
                    {r.tenantName}
                  </Link>
                  {r.tenantEmail && (
                    <div className="text-xs text-muted-2 truncate max-w-[220px]">
                      {r.tenantEmail}
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 text-fg whitespace-nowrap">
                  {r.buildingName}
                </td>
                <td className="px-3 py-3 font-mono text-muted whitespace-nowrap">
                  {r.unitLabel}
                </td>
                <td className="px-3 py-3 text-right font-medium tabular-nums whitespace-nowrap">
                  ${(r.monthlyRent / 100).toLocaleString()}
                </td>
                <td className="px-3 py-3 text-muted tabular-nums whitespace-nowrap">
                  {r.startDateIso}
                </td>
                <td className="px-3 py-3 text-muted tabular-nums whitespace-nowrap">
                  {r.endDateIso ?? "—"}
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <StatusPill status={r.derivedStatus} />
                </td>
                <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                  {r.outstandingCents > 0 ? (
                    <span className="text-accent font-medium">
                      ${(r.outstandingCents / 100).toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-muted-2">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  onClick,
  active,
  asc,
  align = "left",
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  asc: boolean;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-4 py-3 text-xs uppercase tracking-[0.12em] text-muted-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-fg transition-colors ${active ? "text-ink" : ""}`}
      >
        {children}
        {active && <span aria-hidden>{asc ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "late"
      ? "bg-accent/10 text-accent border-accent/30"
      : status === "notice-given"
        ? "bg-ink/5 text-ink border-ink/20"
        : status === "ended"
          ? "bg-muted-2/10 text-muted-2 border-muted-2/30"
          : "bg-emerald-50 text-emerald-700 border-emerald-200";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${tone}`}
    >
      {status.replace("-", " ")}
    </span>
  );
}
