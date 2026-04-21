import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  getARAging,
  getRentRoll,
  type RentRollRow,
  type ARAgingRow,
} from "@/lib/dashboard/metrics";

/**
 * Natural-language portfolio query.
 *
 * Security posture (this is the guardrail the spec asks us to describe):
 *
 *   * The LLM NEVER writes SQL. It calls a single tool (`run_query`) whose
 *     input is a structured `QuerySpec` — an enum-bounded entity name, a
 *     filter array with enum-bounded operators, an optional orderBy, and a
 *     numeric limit. No string op can sneak through because the schema
 *     `enum` on `op` blocks anything that isn't a pre-approved read
 *     operator. There is no `sql` field, no `raw` escape hatch.
 *   * The executor is a fixed dispatch to prisma.findMany (or to one of
 *     two pre-aggregated views). DROP/DELETE/UPDATE/ALTER are structurally
 *     impossible because there is no code path from `QuerySpec` to a raw
 *     query builder. We never template user input into an SQL string.
 *   * Unknown entities, unknown fields, or unknown operators are rejected
 *     server-side BEFORE the first Prisma call — a zod safeParse followed
 *     by an allow-list check.
 *   * Result sets are capped at 100 rows so a runaway `limit` can't pull
 *     the whole tenant table.
 *   * Prisma queries go through a reader-only session (no write helpers
 *     are wired into the executor). Even if someone smuggled a mutation,
 *     the executor doesn't expose `create`/`update`/`delete`.
 */

const MODEL = "claude-haiku-4-5-20251001";

const ENTITIES = [
  "tenants",
  "leases",
  "ar_aging",
  "rent_roll",
  "charges",
  "payments",
  "work_orders",
  "vendors",
] as const;
type Entity = (typeof ENTITIES)[number];

const OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains"] as const;
type Operator = (typeof OPERATORS)[number];

// Field allow-list per entity. If an LLM-supplied field isn't here, we
// reject before touching the DB.
const FIELD_ALLOWLIST: Record<Entity, string[]> = {
  tenants: ["firstName", "lastName", "email", "status", "notes"],
  leases: [
    "monthlyRent",
    "securityDeposit",
    "status",
    "startDate",
    "endDate",
    "tenantName",
    "buildingName",
    "unitLabel",
  ],
  ar_aging: [
    "tenantName",
    "outstandingCents",
    "bucket",
    "oldestUnpaidDate",
  ],
  rent_roll: [
    "tenantName",
    "buildingName",
    "unitLabel",
    "monthlyRent",
    "derivedStatus",
    "leaseStatus",
    "outstandingCents",
    "startDate",
    "endDate",
  ],
  charges: ["amount", "type", "chargeDate", "description"],
  payments: ["amount", "method", "paymentDate", "notes"],
  work_orders: ["category", "status", "cost", "vendorName", "openedDate", "closedDate"],
  vendors: ["vendorName", "totalSpend", "workOrderCount"],
};

const filterSchema = z.object({
  field: z.string(),
  op: z.enum(OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const querySpecSchema = z.object({
  entity: z.enum(ENTITIES),
  filters: z.array(filterSchema).max(6).default([]),
  orderBy: z
    .object({
      field: z.string(),
      direction: z.enum(["asc", "desc"]),
    })
    .nullish(),
  limit: z.number().int().min(1).max(100).default(25),
});

export type QuerySpec = z.infer<typeof querySpecSchema>;

const queryTool: Anthropic.Tool = {
  name: "run_query",
  description:
    "Run a read-only structured query against the property-management database and return matching rows.",
  input_schema: {
    type: "object",
    required: ["entity"],
    properties: {
      entity: {
        type: "string",
        enum: [...ENTITIES],
        description:
          "Which collection to query. ar_aging is pre-aggregated: one row per tenant with total outstanding. rent_roll is also pre-aggregated: one row per active lease with derived status and balance.",
      },
      filters: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          required: ["field", "op", "value"],
          properties: {
            field: {
              type: "string",
              description: "Field on the selected entity. Use the entity's natural field names.",
            },
            op: {
              type: "string",
              enum: [...OPERATORS],
              description: "Comparison operator. Read-only — no mutation ops exist.",
            },
            value: {
              description:
                "Comparison value. Numbers are dollars (we convert to cents) for monetary fields; strings for text and enum fields; ISO yyyy-mm-dd for dates.",
            },
          },
        },
      },
      orderBy: {
        type: "object",
        required: ["field", "direction"],
        properties: {
          field: { type: "string" },
          direction: { type: "string", enum: ["asc", "desc"] },
        },
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        description: "Cap rows. Default 25, max 100.",
      },
    },
  },
};

const SYSTEM_PROMPT = `You are the portfolio analyst for a property-management platform. You help the user answer questions about their data by calling the run_query tool.

Call the tool with a QuerySpec. Pick the most specific entity:

- rent_roll — active leases with derived current/late/notice-given status and outstanding balance per lease. Best for rent-status questions.
- ar_aging — tenants with outstanding balances, grouped into 0-30 / 31-60 / 61-90 / 90+ buckets. Best for past-due questions.
- tenants, leases, charges, payments, work_orders, vendors — raw data access when the aggregates don't fit.

Rules:
- Monetary thresholds in the user's query are dollars. The tool converts to cents internally; supply values as dollars (e.g. 5000 for $5,000).
- For past-due questions, prefer ar_aging filtered on outstandingCents gt <threshold>.
- For "show vendors we paid more than $X", use the vendors entity with totalSpend.
- Write ONE short conversational sentence (max ~20 words) alongside the tool call — warm, confident, no preambles.

Always call run_query. If the request is ambiguous, call with your best guess and mention the ambiguity in your reply.`;

// ─── Executor ────────────────────────────────────────────────────────

export type QueryResultRow = Record<string, string | number | null>;

export type QueryResult = {
  columns: { key: string; label: string }[];
  rows: QueryResultRow[];
  truncated: boolean;
};

async function executeQuery(spec: QuerySpec): Promise<QueryResult> {
  const allowedFields = FIELD_ALLOWLIST[spec.entity];
  for (const f of spec.filters) {
    if (!allowedFields.includes(f.field)) {
      throw new Error(
        `Field "${f.field}" is not queryable on ${spec.entity}. Allowed: ${allowedFields.join(", ")}.`,
      );
    }
  }
  if (spec.orderBy && !allowedFields.includes(spec.orderBy.field)) {
    throw new Error(
      `Cannot order ${spec.entity} by "${spec.orderBy.field}".`,
    );
  }

  switch (spec.entity) {
    case "rent_roll":
      return executeRentRoll(spec);
    case "ar_aging":
      return executeARAging(spec);
    case "tenants":
      return executeTenants(spec);
    case "leases":
      return executeLeases(spec);
    case "charges":
      return executeCharges(spec);
    case "payments":
      return executePayments(spec);
    case "work_orders":
      return executeWorkOrders(spec);
    case "vendors":
      return executeVendors(spec);
  }
}

function dollarsToCentsIfMoney(field: string, value: unknown): unknown {
  const moneyFields = new Set([
    "monthlyRent",
    "outstandingCents",
    "amount",
    "cost",
    "totalSpend",
    "securityDeposit",
  ]);
  if (moneyFields.has(field) && typeof value === "number") return value * 100;
  return value;
}

function applyInMemoryFilters<T extends Record<string, unknown>>(
  rows: T[],
  filters: QuerySpec["filters"],
): T[] {
  return rows.filter((r) =>
    filters.every((f) => {
      const v = dollarsToCentsIfMoney(f.field, f.value);
      const lhs = r[f.field];
      if (lhs === null || lhs === undefined) return false;
      switch (f.op) {
        case "eq":
          return String(lhs).toLowerCase() === String(v).toLowerCase();
        case "neq":
          return String(lhs).toLowerCase() !== String(v).toLowerCase();
        case "gt":
          return Number(lhs) > Number(v);
        case "gte":
          return Number(lhs) >= Number(v);
        case "lt":
          return Number(lhs) < Number(v);
        case "lte":
          return Number(lhs) <= Number(v);
        case "contains":
          return String(lhs).toLowerCase().includes(String(v).toLowerCase());
      }
    }),
  );
}

function sortAndLimit<T extends Record<string, unknown>>(
  rows: T[],
  spec: QuerySpec,
): T[] {
  if (spec.orderBy) {
    const f = spec.orderBy.field;
    const dir = spec.orderBy.direction === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[f];
      const bv = b[f];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av instanceof Date && bv instanceof Date) {
        return (av.getTime() - bv.getTime()) * dir;
      }
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }
  return rows.slice(0, spec.limit);
}

async function executeRentRoll(spec: QuerySpec): Promise<QueryResult> {
  const rows = await getRentRoll();
  const flat = rows.map((r) => ({
    tenantName: r.tenantName,
    buildingName: r.buildingName,
    unitLabel: r.unitLabel,
    monthlyRent: r.monthlyRent,
    derivedStatus: r.derivedStatus,
    leaseStatus: r.leaseStatus,
    outstandingCents: r.outstandingCents,
    startDate: r.startDate,
    endDate: r.endDate,
  }));
  const filtered = applyInMemoryFilters(flat, spec.filters);
  const sliced = sortAndLimit(filtered, spec);
  return {
    columns: [
      { key: "tenantName", label: "Tenant" },
      { key: "buildingName", label: "Building" },
      { key: "unitLabel", label: "Unit" },
      { key: "monthlyRent", label: "Monthly rent" },
      { key: "derivedStatus", label: "Status" },
      { key: "outstandingCents", label: "Outstanding" },
    ],
    rows: sliced.map((r) => ({
      tenantName: r.tenantName,
      buildingName: r.buildingName,
      unitLabel: r.unitLabel,
      monthlyRent: r.monthlyRent,
      derivedStatus: r.derivedStatus,
      outstandingCents: r.outstandingCents,
    })),
    truncated: filtered.length > spec.limit,
  };
}

async function executeARAging(spec: QuerySpec): Promise<QueryResult> {
  const { rows } = await getARAging();
  const flat = rows.map((r: ARAgingRow) => ({
    tenantName: r.tenantName,
    outstandingCents: r.outstandingCents,
    bucket: r.bucket,
    oldestUnpaidDate: r.oldestUnpaidDate,
  }));
  const filtered = applyInMemoryFilters(flat, spec.filters);
  const sliced = sortAndLimit(filtered, spec);
  return {
    columns: [
      { key: "tenantName", label: "Tenant" },
      { key: "outstandingCents", label: "Outstanding" },
      { key: "bucket", label: "Age bucket" },
      { key: "oldestUnpaidDate", label: "Oldest unpaid" },
    ],
    rows: sliced.map((r) => ({
      tenantName: r.tenantName,
      outstandingCents: r.outstandingCents,
      bucket: r.bucket,
      oldestUnpaidDate: r.oldestUnpaidDate instanceof Date
        ? r.oldestUnpaidDate.toISOString().slice(0, 10)
        : null,
    })),
    truncated: filtered.length > spec.limit,
  };
}

async function executeTenants(spec: QuerySpec): Promise<QueryResult> {
  const rows = await prisma.tenant.findMany({
    take: 500,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      status: true,
      notes: true,
    },
  });
  const filtered = applyInMemoryFilters(rows, spec.filters);
  const sliced = sortAndLimit(filtered, spec);
  return {
    columns: [
      { key: "firstName", label: "First" },
      { key: "lastName", label: "Last" },
      { key: "email", label: "Email" },
      { key: "status", label: "Status" },
    ],
    rows: sliced.map((r) => ({
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      status: r.status,
    })),
    truncated: filtered.length > spec.limit,
  };
}

async function executeLeases(spec: QuerySpec): Promise<QueryResult> {
  const rows = await prisma.lease.findMany({
    take: 500,
    include: {
      tenant: true,
      unit: { include: { building: true } },
    },
  });
  const flat = rows.map((l) => ({
    tenantName: `${l.tenant.firstName} ${l.tenant.lastName}`,
    buildingName: l.unit.building.name,
    unitLabel: l.unit.label,
    monthlyRent: l.monthlyRent,
    securityDeposit: l.securityDeposit,
    status: l.status,
    startDate: l.startDate,
    endDate: l.endDate,
  }));
  const filtered = applyInMemoryFilters(flat, spec.filters);
  const sliced = sortAndLimit(filtered, spec);
  return {
    columns: [
      { key: "tenantName", label: "Tenant" },
      { key: "buildingName", label: "Building" },
      { key: "unitLabel", label: "Unit" },
      { key: "monthlyRent", label: "Monthly rent" },
      { key: "status", label: "Status" },
      { key: "startDate", label: "Start" },
      { key: "endDate", label: "End" },
    ],
    rows: sliced.map((r) => ({
      tenantName: r.tenantName,
      buildingName: r.buildingName,
      unitLabel: r.unitLabel,
      monthlyRent: r.monthlyRent,
      status: r.status,
      startDate: r.startDate.toISOString().slice(0, 10),
      endDate: r.endDate ? r.endDate.toISOString().slice(0, 10) : null,
    })),
    truncated: filtered.length > spec.limit,
  };
}

async function executeCharges(spec: QuerySpec): Promise<QueryResult> {
  const rows = await prisma.charge.findMany({ take: 1000 });
  const filtered = applyInMemoryFilters(rows, spec.filters);
  const sliced = sortAndLimit(filtered, spec);
  return {
    columns: [
      { key: "chargeDate", label: "Date" },
      { key: "type", label: "Type" },
      { key: "amount", label: "Amount" },
      { key: "description", label: "Description" },
    ],
    rows: sliced.map((r) => ({
      chargeDate: r.chargeDate.toISOString().slice(0, 10),
      type: r.type,
      amount: r.amount,
      description: r.description,
    })),
    truncated: filtered.length > spec.limit,
  };
}

async function executePayments(spec: QuerySpec): Promise<QueryResult> {
  const rows = await prisma.payment.findMany({ take: 1000 });
  const filtered = applyInMemoryFilters(rows, spec.filters);
  const sliced = sortAndLimit(filtered, spec);
  return {
    columns: [
      { key: "paymentDate", label: "Date" },
      { key: "method", label: "Method" },
      { key: "amount", label: "Amount" },
      { key: "notes", label: "Notes" },
    ],
    rows: sliced.map((r) => ({
      paymentDate: r.paymentDate.toISOString().slice(0, 10),
      method: r.method,
      amount: r.amount,
      notes: r.notes,
    })),
    truncated: filtered.length > spec.limit,
  };
}

async function executeWorkOrders(spec: QuerySpec): Promise<QueryResult> {
  const rows = await prisma.workOrder.findMany({ take: 500 });
  const filtered = applyInMemoryFilters(rows, spec.filters);
  const sliced = sortAndLimit(filtered, spec);
  return {
    columns: [
      { key: "openedDate", label: "Opened" },
      { key: "category", label: "Category" },
      { key: "status", label: "Status" },
      { key: "vendorName", label: "Vendor" },
      { key: "cost", label: "Cost" },
    ],
    rows: sliced.map((r) => ({
      openedDate: r.openedDate.toISOString().slice(0, 10),
      category: r.category,
      status: r.status,
      vendorName: r.vendorName,
      cost: r.cost,
    })),
    truncated: filtered.length > spec.limit,
  };
}

async function executeVendors(spec: QuerySpec): Promise<QueryResult> {
  const rows = await prisma.workOrder.groupBy({
    by: ["vendorName"],
    _sum: { cost: true },
    _count: { _all: true },
  });
  const flat = rows.map((r) => ({
    vendorName: r.vendorName,
    totalSpend: r._sum.cost ?? 0,
    workOrderCount: r._count._all,
  }));
  const filtered = applyInMemoryFilters(flat, spec.filters);
  const sliced = sortAndLimit(filtered, spec);
  return {
    columns: [
      { key: "vendorName", label: "Vendor" },
      { key: "totalSpend", label: "Total spend" },
      { key: "workOrderCount", label: "# work orders" },
    ],
    rows: sliced.map((r) => ({
      vendorName: r.vendorName,
      totalSpend: r.totalSpend,
      workOrderCount: r.workOrderCount,
    })),
    truncated: filtered.length > spec.limit,
  };
}

// ─── Public API ──────────────────────────────────────────────────────

export type NLQueryResponse = {
  reply: string;
  spec: QuerySpec | null;
  result: QueryResult | null;
  error?: string;
  source: "llm" | "fallback";
};

export async function answerNLQuery(question: string): Promise<NLQueryResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    // Fallback: simple keyword probe so the UI is functional without a key.
    return {
      reply: "AI is offline — showing the full AR aging as a sensible default.",
      spec: {
        entity: "ar_aging",
        filters: [],
        orderBy: { field: "outstandingCents", direction: "desc" },
        limit: 25,
      },
      result: await executeQuery({
        entity: "ar_aging",
        filters: [],
        orderBy: { field: "outstandingCents", direction: "desc" },
        limit: 25,
      }),
      source: "fallback",
    };
  }

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      temperature: 0.1,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [queryTool],
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: question }],
    });

    let reply = "";
    let rawSpec: unknown = null;
    for (const block of response.content) {
      if (block.type === "text") reply += block.text;
      if (block.type === "tool_use" && block.name === "run_query") {
        rawSpec = block.input;
      }
    }

    const parsed = querySpecSchema.safeParse(rawSpec);
    if (!parsed.success) {
      return {
        reply:
          reply.trim() ||
          "I couldn't build a valid query for that — try rephrasing with a specific number or field.",
        spec: null,
        result: null,
        error: parsed.error.issues.map((i) => i.message).join("; "),
        source: "llm",
      };
    }

    const result = await executeQuery(parsed.data);
    return {
      reply:
        reply.trim() ||
        `Found ${result.rows.length} ${parsed.data.entity.replace("_", " ")}${result.rows.length === 1 ? "" : "s"}.`,
      spec: parsed.data,
      result,
      source: "llm",
    };
  } catch (err) {
    console.error("[answerNLQuery] failed:", err);
    return {
      reply: "Something went wrong running that query. Try a simpler phrasing.",
      spec: null,
      result: null,
      error: err instanceof Error ? err.message : String(err),
      source: "llm",
    };
  }
}
