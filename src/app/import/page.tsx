import type { Metadata } from "next";
import { importFromSample, importFromUpload } from "./actions";
import SampleButton from "./sample-button";

export const metadata: Metadata = {
  title: "Import from Buildium",
  description: "One-button import of your existing property-management data.",
};

export default function ImportPage() {
  return (
    <main className="flex-1">
      <div className="mx-auto max-w-4xl px-6 py-14">
        <p className="text-xs uppercase tracking-[0.18em] text-accent font-medium">
          Property management · Day-1 import
        </p>
        <h1 className="mt-3 font-display text-5xl sm:text-6xl tracking-tight text-ink leading-[1.05]">
          One-button import from Buildium.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted leading-relaxed">
          Upload your Buildium export zip. We&rsquo;ll parse every CSV,
          normalize the messy parts (duplicate tenants, property-name
          variants, orphaned references), and show you exactly what we found
          before a single row lands in your database.
        </p>

        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          <section className="rounded-2xl border border-border bg-bg-elevated p-8">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-2">
              01 · Upload
            </p>
            <h2 className="mt-2 font-display text-2xl tracking-tight text-ink">
              Your Buildium export
            </h2>
            <p className="mt-2 text-sm text-muted">
              Drop the entire export zip. We expect the standard six CSVs:
              tenants, units, leases, charges, payments, work orders.
            </p>
            <form
              action={importFromUpload}
              className="mt-6 space-y-4"
              encType="multipart/form-data"
            >
              <label className="block">
                <span className="sr-only">Buildium export zip</span>
                <input
                  type="file"
                  name="zip"
                  accept=".zip,application/zip"
                  required
                  className="block w-full text-sm text-muted file:mr-4 file:py-2.5 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-medium file:bg-ink file:text-white hover:file:bg-black file:cursor-pointer"
                />
              </label>
              <button
                type="submit"
                className="w-full rounded-full bg-ink text-white py-3 text-sm font-medium hover:bg-black transition-colors"
              >
                Parse &amp; preview
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-border bg-bg-elevated p-8">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-2">
              02 · Or try the sample
            </p>
            <h2 className="mt-2 font-display text-2xl tracking-tight text-ink">
              See it end-to-end first
            </h2>
            <p className="mt-2 text-sm text-muted">
              Run the import against a synthetic Buildium export bundled with
              the demo — 150 tenants, 130 leases, 800 charges, 650 payments,
              60 work orders, and every edge case we&rsquo;ve seen in the
              wild.
            </p>
            <form action={importFromSample} className="mt-6">
              <SampleButton />
            </form>
          </section>
        </div>

        <section className="mt-14 rounded-2xl border border-border bg-bg p-8">
          <h3 className="font-display text-xl tracking-tight text-ink">
            What we check for
          </h3>
          <ul className="mt-4 grid sm:grid-cols-2 gap-x-8 gap-y-3 text-sm text-muted">
            <li>· Duplicate tenant emails (case-insensitive)</li>
            <li>· Mixed date formats (MM/DD/YYYY and YYYY-MM-DD)</li>
            <li>· Orphaned lease / tenant / unit references</li>
            <li>· Property-name variants for the same building</li>
            <li>· Negative square footage, negative amounts</li>
            <li>· Zero-amount and split payments</li>
            <li>· Leases where end_date is before start_date</li>
            <li>· Overlapping active leases on one unit</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
