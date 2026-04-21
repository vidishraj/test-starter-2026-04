"use client";

import { useState, useTransition } from "react";
import { runNLQuery } from "./nl-query-actions";
import type { NLQueryResponse, QuerySpec } from "@/lib/ai/nl-query";

const EXAMPLES = [
  "tenants with past-due rent over $5,000",
  "vendors we paid more than $10,000 this year",
  "leases ending in the next 60 days",
  "work orders still open",
];

const MONEY_FIELDS = new Set([
  "monthlyRent",
  "outstandingCents",
  "amount",
  "cost",
  "totalSpend",
  "securityDeposit",
]);

export default function NLQuery() {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<NLQueryResponse | null>(null);
  const [pending, startTransition] = useTransition();

  const ask = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const r = await runNLQuery(trimmed);
      setResult(r);
    });
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    ask(value);
  };

  return (
    <section className="rounded-2xl border border-border bg-bg-elevated p-6">
      <div className="flex items-start gap-4">
        <div className="shrink-0 h-9 w-9 rounded-full bg-ink text-white flex items-center justify-center font-display text-[15px]">
          ?
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display text-xl tracking-tight text-ink">
            Ask your portfolio
          </p>
          <p className="mt-0.5 text-sm text-muted">
            Plain English → structured query. No raw SQL ever hits the database — the AI emits a safe spec we execute via Prisma.
          </p>

          <form onSubmit={onSubmit} className="mt-4">
            <div className="relative rounded-full border border-border bg-bg focus-within:border-ink transition-colors">
              <input
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="e.g. tenants past-due over $5,000"
                className="w-full bg-transparent pl-5 pr-28 py-3 text-[15px] placeholder:text-muted-2 focus:outline-none"
                autoComplete="off"
                disabled={pending}
              />
              <button
                type="submit"
                disabled={pending || !value.trim()}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-ink text-white px-4 py-2 text-sm font-medium hover:bg-black disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {pending ? "Asking…" : "Ask"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setValue(ex);
                    ask(ex);
                  }}
                  disabled={pending}
                  className="rounded-full border border-border bg-bg px-3 py-1.5 text-xs text-muted hover:text-fg hover:border-ink transition-colors disabled:opacity-60"
                >
                  {ex}
                </button>
              ))}
            </div>
          </form>

          {result && <ResultBlock result={result} />}
        </div>
      </div>
    </section>
  );
}

function ResultBlock({ result }: { result: NLQueryResponse }) {
  return (
    <div className="mt-6 border-t border-border pt-5">
      <p className="text-[15px] text-fg">{result.reply}</p>
      {result.source === "fallback" && (
        <p className="mt-1 text-xs text-accent">
          AI parse is offline — returning a sensible default.
        </p>
      )}
      {result.error && (
        <p className="mt-1 text-xs text-accent">
          Couldn&rsquo;t run that: {result.error}
        </p>
      )}
      {result.spec && <SpecPill spec={result.spec} />}
      {result.result && result.result.rows.length > 0 ? (
        <div className="mt-4 rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg">
                <tr>
                  {result.result.columns.map((c) => (
                    <th
                      key={c.key}
                      className="px-3 py-2 text-left text-xs uppercase tracking-[0.12em] text-muted-2 font-medium"
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.result.rows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    {result.result!.columns.map((c) => {
                      const val = r[c.key];
                      const isMoney = MONEY_FIELDS.has(c.key);
                      return (
                        <td
                          key={c.key}
                          className="px-3 py-2 text-fg tabular-nums"
                        >
                          {val === null || val === undefined
                            ? "—"
                            : isMoney && typeof val === "number"
                              ? `$${(val / 100).toLocaleString()}`
                              : String(val)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.result.truncated && (
            <p className="px-3 py-2 bg-bg text-xs text-muted-2 border-t border-border">
              …truncated to {result.result.rows.length} rows. Refine your
              question for a narrower result set.
            </p>
          )}
        </div>
      ) : result.result && result.result.rows.length === 0 ? (
        <p className="mt-4 text-muted italic">No rows matched that query.</p>
      ) : null}
    </div>
  );
}

function SpecPill({ spec }: { spec: QuerySpec }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-muted-2 hover:text-fg">
        view generated query spec
      </summary>
      <pre className="mt-2 rounded-lg border border-border bg-bg p-3 text-xs font-mono text-muted overflow-x-auto">
        {JSON.stringify(spec, null, 2)}
      </pre>
    </details>
  );
}
