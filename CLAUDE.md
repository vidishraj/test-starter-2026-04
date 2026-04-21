@AGENTS.md

# Project context — RDE Advisors engineering test (2026-04-21)

This repo is a **paid 3.5-hour timed engineering test** for RDE Advisors (Ross, founder, NYC CRE, non-technical). Full spec is in `TEST_SPEC.md`. Commit timestamps are audited — commit every ~30 min with meaningful messages, never squash/rebase.

The two products being prototyped:

1. **Beyond the Space (BTS)** — chat-first NYC office search (vs. VTS / Loopnet). AI parses free-text queries into structured filters.
2. **Property Management platform** — Buildium/Appfolio/Yardi-class PM with a "one-button import" wedge. Build + Integration are weighted **50/50**.

Schema must be **phase-2-ready** for a QuickBooks replacement (real double-entry GL bolts on later) — don't paint into a corner now.

## Scope (5 parts, 205 min of coding inside 210 min clock)

| # | Path | What |
|---|---|---|
| 1 | `/`, `/search`, `/listings/[slug]` | BTS chat-first search. Homepage = single textbox + chips. `/search` SSR on first load, one Anthropic call returns conversational reply **and** structured filter `{submarket, sfMin, sfMax, features, subleaseOrDirect}`. Detail page has **scrubbable** hero media (drag / arrow keys, preload neighbors). No filter sidebar — that's the wrong paradigm. |
| 2 | `/import` | Parse `data/buildium_export.zip` (6 CSVs). Upload OR "Try with sample data" → progress → **preview** (counts, duplicates, orphans, parse failures — flagged, not dropped) → Commit → success w/ deep links. **Idempotent.** Surface ≥2 edge cases. |
| 3 | `/dashboard` | Rent roll (sortable, CSV export) • AR aging (0–30 / 31–60 / 61–90 / 90+, drill into tenant history) • Expense chart (stacked bar, 12 mo; synthetic fill OK) • NL query bar w/ Anthropic tool use — **guardrail against destructive SQL** (no DROP/DELETE/UPDATE/ALTER). |
| 4 | `SUBMISSION.md` | Five written answers W1–W5 (150–250 words each): W1 scraping + watermark removal at scale (name the IP/legal risk), W2 phase-2 QuickBooks replacement, W3 extending AI beyond search, W4 AI-assisted floor-plan designer, W5 cost control at bootstrap scale incl. **one-page cost table @ 10K/50K/100K searches** and 3 specific Claude API cost traps. |
| 5 | Loom 5–10 min | Live deploy walkthrough • **mandatory** 60-sec non-technical founder explanation • **mandatory** 2-min walkthrough of 3 code decisions (what / rejected / why) • AI tool disclosure. |

Also in `SUBMISSION.md` (scored): 200-word plain-English architecture overview, phase-2 schema evolution paragraph, edge-cases paragraph, NL-query guardrail paragraph, **Decisions & Tradeoffs ≥5 choices each tied to a specific file/function**.

## Stack gotchas (see AGENTS.md)

- Next.js 16, React 19, Prisma 7, Tailwind 4 — breaking changes vs. training data.
- Prisma `DATABASE_URL` lives in `prisma.config.ts` (reads `.env`), **not** `schema.prisma`.
- Generated Prisma client is at `src/generated/prisma` — there is no `@prisma/client` package installed.
- `.env` must contain `DATABASE_URL="file:./dev.db"` **before** any `prisma migrate`.

## Data gotchas (see README "Known quirks" — intentional, don't silently drop)

- `listings.json`: `submarket` has both `"Grand Central"` and `"Grand Central Area"` — normalize.
- `buildium_export.zip` intentional messiness:
  - **tenants**: dup emails, malformed emails, em-dash in last name, mixed date formats (MM/DD/YYYY vs YYYY-MM-DD).
  - **units**: property-name variants for the same building (`"1234 Elm St"`, `"1234 Elm Street"`, `"1234 Elm St."`), negative sqft, NULL monthly rent.
  - **leases**: orphan `tenant_id`, `end_date` before `start_date`, overlapping active leases on same unit.
  - **charges**: orphan `lease_id`, negative amounts.
  - **payments**: orphan `lease_id`, zero-amount, split payments (same lease + date across 2 rows).
  - **work_orders**: open orders with no `closed_date`, Spanish descriptions (UTF-8), apostrophes in vendor names (`O'Malley & Sons`), negative cost.

## Deploy requirement

Live deploy URL must be **publicly accessible** — no Vercel SSO, no password wall. Neon direct (unpooled) connection string for `DATABASE_URL` in all 3 Vercel scopes. Provider switch SQLite→Postgres requires deleting `prisma/migrations/` and regenerating (see README "Deploying to Vercel").

## Working priorities under time pressure

- Ship one thing well over three things broken.
- Build-half and Integration-half are **equally weighted** — don't punt either.
- Writing (SUBMISSION.md + commit messages + Loom) is graded as heavily as code.
- "Looks like a product we'd brag about" > default Tailwind. Design taste matters.
- Explicitly called out as low-value: test coverage, perfect lint, over-polished pixels.
