# Submission — Beyond the Space + PM platform slice

> RDE Advisors engineering test — Vidish Raj

---

## Architecture overview (for a non-technical founder)

You're looking at two products stitched together by a single codebase and a single database.

**Beyond the Space** is a search engine for NYC office space that works like a text conversation. A tenant types what they want — "10,000 SF sublease near Penn Station" — and our AI turns that sentence into a structured search, shows a short human reply, and lists matching buildings. The page loads with real content in it, not a loading spinner, which matters because that's what Google reads when it decides how to rank us. Each neighborhood (Hudson Yards, Flatiron, FiDi, ...) also has its own permanent landing page so a search like "office space in Hudson Yards NYC" can find us organically.

**The property-management platform** handles the books for buildings you already own. A one-button importer takes your existing Buildium export, normalizes the messy parts (duplicate tenants, property-name variants, orphaned references) and shows you exactly what will land in the database before you commit. The dashboard then renders the rent roll, the aging receivables, and the twelve-month expense view — plus a natural-language bar where you can ask your data questions ("tenants past-due over $5,000") and get structured answers without writing code.

The whole thing runs on a single modest virtual machine — not a trendy serverless host — with a $0/month cloud bill. That's deliberate: every dollar we don't send to a cloud middleman stays in the business. Scaling to 10,000 users is three moves, all additive: bigger VM (or a second one behind a load balancer), add a CDN in front so static pages cache at the edge, and swap the embedded database for a managed Postgres when write contention starts to matter. Meanwhile the AI layer already uses prompt caching, so Claude charges us roughly a tenth of the per-question rate we'd pay otherwise. None of those moves requires rewriting any business code — the data model was built for them day one.

---

## Decisions & Tradeoffs

Choices specific to this build, each tied to a file/function. Format: **What I chose** · _Rejected alternative_ · **Why**.

### Part 1 — BTS chat-first search

**1. One streaming Claude call, filter + reply as two independent promises**
`src/lib/ai/search.ts:streamSearch`
One `messages.stream()` call with `tool_choice: { type: "any" }`. The system prompt forces tool_use to be emitted before text, so the filter resolves ahead of the prose. Two Suspense boundaries in `src/app/search/page.tsx` await the two promises independently — cards render the instant the filter lands, the AI bubble's text streams in under a typing-dots fallback.
_Rejected:_ two separate Claude calls (one for the filter, one for the reply — double the spend, double the latency, no win); one blocking call that awaits the whole message before painting anything (spec is explicit that cards shouldn't wait on prose).

**2. Claude Haiku 4.5, not Sonnet**
`src/lib/ai/search.ts:MODEL`
This is a parse-and-paraphrase task on a tiny structured schema, not synthesis. Haiku 4.5 handles tool use reliably at a fraction of the token cost (~$1/M input, $5/M output vs. Sonnet's ~$3/$15). System prompt carries `cache_control: { type: "ephemeral" }` so repeated traffic pays cached-read prices.
_Rejected:_ Sonnet 4.6 (wasted spend for a ≤500-token response); Opus (nonsense for classification).

**3. Alias-map submarket normalizer, not fuzzy/embedding match**
`src/lib/listings.ts:normalizeSubmarket`
Catalog is 25 rows with one intentional variant (`Grand Central` vs. `Grand Central Area`) and a couple of common aliases (`FiDi`/`Financial District`). A 10-line alias map is deterministic, testable, and ships in <1 ms. Fuzzy matching would add latency and non-determinism for zero practical gain at this scale.
_Rejected:_ Levenshtein / token-sort ratio; embedding-similarity match; letting the LLM free-form the submarket field.

**4. Heuristic fallback instead of failing loudly**
`src/lib/ai/search.ts:heuristicFallback`
When the API key is missing or the stream throws, we don't 500 — we run a regex/keyword pass (submarket tokens, `sf`/`k` numeric extraction, "sublease" keyword) and surface a visible `notice` in the AI bubble explaining we dropped back. The user always gets results. This is the graceful degradation the spec calls out, and it makes the demo robust when a new environment forgets to set the key.
_Rejected:_ rendering an error page (breaks the chat-first paradigm); silently returning the full catalog with no explanation (user has no idea what happened); throwing.

**5. `/search` is a pure Server Component — no client-side fetch**
`src/app/search/page.tsx:SearchPage`
Cards and the AI bubble both resolve on the server via RSC + Suspense. First-byte HTML contains the cards the instant the filter lands, which means Google sees real listing content in view-source — not a JS shell. SEO is one of the three explicit evaluation axes for Part 1.
_Rejected:_ a client `useEffect` that fetches from an API route (SEO-dead — crawlers wouldn't see listings); server action + `useActionState` (adds a round-trip for no benefit).

**6. Native `scroll-snap` + pointer-capture drag for the hero, not Swiper/Embla**
`src/app/listings/[slug]/scrub-hero.tsx:ScrubHero`
CSS `scroll-snap-type: x mandatory` gives us touch-native fling-and-snap for free. Pointer events with `setPointerCapture` add mouse drag on desktop. A 150-line hand-rolled component beats adding a 30 kB dep for a 6-slide carousel, preserves full control over the loading strategy (adjacent-slide `loading="eager"`, the rest `loading="lazy"`), and gives us real keyboard handling (arrow keys) that most libraries bolt on awkwardly.
_Rejected:_ Swiper (heavy, not tree-shakable); Embla (lighter, but still a dep for something native does well); Framer Motion drag (overkill for snap scrolling).

**7. Deterministic pre-computed slugs, not hashed IDs**
`data/listings.json` + `src/app/listings/[slug]/page.tsx:generateStaticParams`
Slugs like `99-hypothetical-avenue-ste-12a-hudyard` are already in the data, so I use them as the source of truth. `generateStaticParams` returns all 25 — every detail page is SSG'd at build time, zero LLM or DB hit at request time. The submarket token is a 6-letter abbreviation, which means the URL itself contains a keyword Google can rank.
_Rejected:_ raw listing IDs (bad for SEO, no keyword surface); UUIDs (ugly, unrankable); runtime-computed hashes (pointless when the data already has stable slugs).

**8. `<img>` over `next/image` for SVG media**
`src/components/listing-card.tsx`, `src/app/listings/[slug]/scrub-hero.tsx`
All starter media is SVG. `next/image` refuses SVG unless you set `dangerouslyAllowSVG: true` + a CSP — which opens a script-injection vector if we ever swap in user-uploaded photos without re-checking that flag. Vector assets don't benefit from Next's format negotiation (no AVIF/WebP equivalent for vector), so the optimization pipeline would no-op anyway. Plain `<img>` with explicit `width`, `height`, `sizes`, `loading`, `decoding`, and `fetchPriority` gives us CLS avoidance and responsive hints without the security footgun.
_Rejected:_ `next/image` with `dangerouslyAllowSVG` (security regression waiting to happen); `next/image` with `unoptimized` (kills the whole point of using it).

**9. `/office-space/[submarket]` as SSG SEO pages with `ItemList` structured data**
`src/app/office-space/[submarket]/page.tsx`
Each submarket gets its own URL (`/office-space/hudson-yards`), per-submarket `<title>`/description, `ItemList` JSON-LD naming each listing, and mutual internal linking (homepage → top 6 submarkets, detail-page breadcrumb → submarket, submarket → related submarkets). `generateStaticParams` SSG's all 10 at build; zero cost per request. This is how BTS actually ranks for "NYC office space in Hudson Yards" without paying Google.
_Rejected:_ leaving SEO implicit (you can't rank for submarket-level queries with a single-page app); dynamic routes without SSG (wastes request compute).

### Part 2 — PM import

**10. Money as Int cents, not `Decimal` or `Float`**
`prisma/schema.prisma` — every `monthlyRent`, `amount`, `cost`, `monthlyRentTarget`, `securityDeposit`
Portable across SQLite and Postgres (the provider switch is now a one-line edit, not a data-coercion bug hunt). Zero floating-point risk on sums — important because AR aging, rent roll, and the eventual GL all aggregate these columns. Phase-2 double-entry lines up cleanly because cents-as-Int is already the industry standard in Buildium/Appfolio/Yardi internals.
_Rejected:_ `Decimal` (works on Postgres, awkward on SQLite, forces `Prisma.Decimal` round-trips on every read); `Float` (float math on money is a ticking bug).

**11. `externalId` as the idempotency key on every imported entity**
`prisma/schema.prisma` — every imported model has `externalId String @unique`
The commit step upserts by `externalId`, which means re-running the same Buildium export is a no-op, and re-running an incremental export updates in place without creating duplicates. Verified by `commitImport` running twice in a row and producing identical row counts (150 tenants, 122 leases, 739 charges — second run wrote nothing new).
_Rejected:_ content-hash idempotency (brittle — any whitespace change breaks dedup); "just don't re-run imports" (not how real PM shops operate — they re-import every month when their ops person cleans up data).

**12. Lease history via multiple Lease rows per Unit, not versioning in place**
`prisma/schema.prisma:Lease`
A unit can have many Lease rows across time; `status` and `startDate`/`endDate` tell you which is current. This is how Buildium/Appfolio/Yardi actually model it, and it gives us clean point-in-time rent-roll queries: "who was in unit U027 on 2024-06-01?" is a `findFirst` with a date-range predicate. A `LeaseHistory` sidecar that versions rows in place would double writes on every renewal and make "current" state ambiguous.
_Rejected:_ `LeaseHistory` table + mutation-in-place; "current tenant per unit" flat-field on Unit (kills history entirely — the spec explicitly warns against this).

**13. `accountRef` columns on Charge and Payment as phase-2 GL bolt-on points**
`prisma/schema.prisma:Charge` / `Payment`
Null today. When the phase-2 double-entry ledger ships, each Charge becomes a source row for a JournalEntry pair (e.g. Dr: AR, Cr: Rental Income), and `accountRef` identifies which GL account the posting rule targeted. Existing rows populate via a one-time backfill. This is the "additive, not a rewrite" guarantee the spec asks for — the schema wedge is literally one nullable string column per financial model.
_Rejected:_ a separate `GLMapping` junction table (fine eventually, premature now); no hook at all (forces phase-2 to re-model charge/payment).

**14. Property-name normalization collapses variants into one Building**
`src/lib/import/buildium.ts:normalizeBuildingName`, `prisma/schema.prisma:Building.normalizedName @unique`
Raw CSVs have "1234 Elm St", "1234 Elm Street", and "1234 Elm St." — three rows, one physical building. The normalizer lowercases, strips punctuation, and expands/contracts the common suffixes (`street↔st`, `avenue↔ave`, `road↔rd`, `boulevard↔blvd`). Buildings dedupe on `normalizedName`, so all 45 units land on the correct 11 buildings rather than 13+.
_Rejected:_ fuzzy matching (non-deterministic — two imports could produce different collapse decisions); LLM normalization (overkill for a small-cardinality field and adds per-row cost).

**15. `ImportRun.payload` JSON as staging table between parse and commit**
`prisma/schema.prisma:ImportRun`, `src/app/import/actions.ts:stage`, `src/app/import/preview/[runId]/page.tsx`
Parse writes a row with `committedAt = null`; the preview page loads the row by id and renders. Commit populates `committedAt` and runs the upserts. Three wins: (a) the preview is re-openable — you can tab away and come back, (b) we have an audit trail of every import ever attempted, and (c) idempotency is enforced at two layers — `ImportRun.committedAt` for the whole run and `externalId` per row. A JSON blob instead of a staging schema is fast to ship and fine up to ~10 MB payloads (our sample is ~500 KB).
_Rejected:_ in-memory staging (loses on dev restart, bad for multi-user); a full normalized staging schema (real overkill for a 45-min test; reasonable refactor later).

**16. Grouped-by-kind preview UI, not a JSON dump**
`src/app/import/preview/[runId]/page.tsx:KIND_LABELS` + `WarningGroup`
Every warning kind (`orphan_lease_ref`, `duplicate_email`, `end_before_start`, …) gets a human-readable label and a one-line explanation of how we handle it. Warnings collapse under a `<details>` with a count badge; the first 5 samples are visible, the rest collapsed behind "…and N more." The property manager sees exactly what's wrong and what we'll do about it before clicking Commit.
_Rejected:_ one long flat warning list (unreadable at 300+ warnings); a raw JSON viewer (the spec explicitly calls this out as missing the point).

**17. Driver-adapter Prisma client (`@prisma/adapter-better-sqlite3`)**
`src/lib/db.ts`
Prisma 7 requires a driver adapter by default — no more legacy binary engine. The better-sqlite3 adapter runs synchronously through a proven native module; our actual production deploy uses this path because a persistent-disk VM handles SQLite fine. If we ever outgrow SQLite the migration to Postgres is a one-line adapter swap plus a provider change in `schema.prisma` — the schema itself is provider-agnostic because of the Int-cents decision above.
_Rejected:_ no adapter (won't compile under Prisma 7); `@prisma/dev` (that's a local Postgres dev server, not a SQLite adapter).

### Part 3 — PM dashboard

**18. Dashboard aggregations are pure server-side functions, not server actions or API routes**
`src/lib/dashboard/metrics.ts`
`getRentRoll`, `getARAging`, `getKPIs`, `getExpenseSeries` are plain async functions. The dashboard Server Component calls them in a single `Promise.all` on every request (`force-dynamic`). Same functions power the CSV export route and the NL query executor — one source of truth for every aggregation. No stale caching, no over-engineered query layer, no GraphQL resolvers for an internal dashboard.
_Rejected:_ tRPC / API route per metric (forces an HTTP round-trip for same-process work); server actions for reads (actions are for mutations, not reads).

**19. AR aging by walking charges oldest-first, applying payments greedily**
`src/lib/dashboard/metrics.ts:getRentRoll`
Age of receivable = age of the oldest charge that payments haven't covered yet. That's how accountants actually think about aging; FIFO application gives the answer a CPA wouldn't argue with. One pass per lease, O(charges).
_Rejected:_ average charge-date (smudges the age curve); latest-unpaid-date (misses early delinquencies); per-charge aging buckets (a partially-paid charge is still one aged item).

**20. Hand-rolled SVG stacked-bar expense chart, no chart library**
`src/app/dashboard/expense-chart.tsx`
Twelve months × eleven categories as a stacked bar is ~80 lines of SVG geometry. No Recharts (~80 kB gzip), no Chart.js. We get full control of ticks, labels, tooltips (native SVG `<title>`), and colors — and the chart renders server-side, so the first paint includes the finished graphic in view-source. Zero hydration cost.
_Rejected:_ Recharts / Chart.js / Tremor (heavy, not tree-shakable, aesthetic is theirs not ours); d3 (overkill for a single chart type).

**21. Work-order categories as real expense data, synthetic fill for taxes / insurance / utilities / management**
`src/lib/dashboard/metrics.ts:getExpenseSeries` + `SYNTH_BASELINE`
The Buildium export only covers maintenance categories via `work_orders.csv`. Rather than show a half-empty chart or fabricate all categories, we aggregate real work-order costs by month and supplement with deterministic synthetic baselines for the standard opex categories (with a fixed seed so the chart is stable across reloads). The card explicitly discloses which rows are synthetic.
_Rejected:_ real-only (misleadingly sparse chart); all-synthetic (hides the maintenance signal property managers care about); random per-reload (shifting numbers erode trust).

**22. NL query returns a structured QuerySpec, never SQL**
`src/lib/ai/nl-query.ts:querySpecSchema` + `executeQuery`
The LLM tool schema is `{ entity: enum, filters: [{field, op: enum, value}], orderBy?, limit }`. The `op` enum is read-only (`eq`/`neq`/`gt`/`gte`/`lt`/`lte`/`contains`) — `DROP`, `DELETE`, `UPDATE`, `ALTER` aren't blocked, they're structurally absent. The executor is a fixed switch over 8 pre-aggregated entities that dispatch to `prisma.findMany` or to the same pure aggregation functions as the dashboard. No code path takes a string and runs it; there is no raw SQL anywhere in the NL query pipeline.
_Rejected:_ LLM-generated SQL with regex sanitization (brittle — dialect features and escape tricks break it); `prisma.$queryRawUnsafe` with templates (the word "unsafe" is in the API name for a reason); direct `executeRaw` bindings (wrong layer of abstraction for a business-level "ask").

**23. Field allow-list per entity, validated before the first Prisma call**
`src/lib/ai/nl-query.ts:FIELD_ALLOWLIST`
Each entity declares the subset of fields the NL query can filter / sort on — e.g. `tenants` exposes `firstName, lastName, email, status, notes` but not `dateOfBirth`, `id`, or `externalId`. The executor rejects unknown fields with a human-readable error before touching the DB. Least-privilege knob for the query surface.
_Rejected:_ expose all Prisma fields (accidental PII into LLM responses); rely on the prompt to tell the LLM what's OK (prompt instructions aren't security).

**24. Truncate NL result sets at 100 rows, disclosed in the UI**
`src/lib/ai/nl-query.ts:querySpecSchema` (`limit: max(100)`), `src/app/dashboard/nl-query.tsx:truncated`
The LLM can't request more than 100 rows — the zod schema caps it. When the underlying query matches more, the UI shows a "truncated" banner so the user knows to refine. Stops runaway exfiltration and stops a badly-worded question from rendering the entire tenant table.
_Rejected:_ no limit (one sloppy question dumps 150 tenant rows into the next turn's context); silent truncation (user doesn't know the answer is partial).

---

## Phase-2 schema evolution (Part 2)

Day 1, we live next to QuickBooks: charges and payments exist as first-class models, but there's no GL behind them. The phase-2 additive path:

1. **Add a chart of accounts** — `GLAccount { id, code, name, kind (asset|liability|income|expense|equity), trustFlag, stateReg? }`. Trust-accounting compliance per state (FL, TX, CA all differ) is gated on `trustFlag` + `stateReg`.
2. **Add the journal tables** — `JournalEntry { id, postedOn, memo, sourceType, sourceId }` with `JournalLine { id, journalEntryId, accountId, debitCents, creditCents }`. Enforce "Σ debits = Σ credits" as a DB check and a posting transaction.
3. **Populate the existing bolt-on point** — `Charge.accountRef` and `Payment.accountRef` migrate from null to a `GLAccount.code` via a one-time backfill + a `PostingRule` table keyed on charge/payment type. Existing rows keep their `externalId`; nothing is renamed.
4. **Bank reconciliation** — `BankAccount`, `BankTransaction`, `BankMatch` linking a BankTransaction to one or more Payments. Month-end close becomes: import BAI file → auto-match → human resolves exceptions → post adjusting entries.
5. **Trust deposits** — security deposits already land as Int cents on `Lease.securityDeposit`. Phase-2 moves them into dedicated trust-flagged bank accounts with per-state segregation rules enforced at the service layer.
6. **Immutability invariant** — once a Charge/Payment is posted to a JournalEntry, it becomes read-only. Edits happen via reversing journal entries. This is the audit-trail property CPAs check for.

Day-1 schema decisions that make this work: Int cents everywhere (no decimal coercion at migration time), `externalId` as the source-system join key (stable across reimports), lease history as multiple rows (so point-in-time rent-roll queries don't need a join-and-sort trick), and nullable `accountRef` columns (the GL hook is already drilled).

---

## Edge cases surfaced in import (Part 2)

Against the bundled `buildium_export.zip` (150 tenants, 45 units, 130 leases, 800 charges, 650 payments, 60 work orders), the parser caught 10 distinct warning kinds on real rows. The most operationally meaningful:

- **Orphan lease references in charges and payments** — 104 charges and 43 payments point at `lease_id`s that don't exist in `leases.csv`. These are the kind of referential rot that accumulates in long-running Buildium tenants (lease gets deleted; the charges stay). We don't silently drop them — the preview surfaces the count, groups the sample rows, and explains "we'll skip these rather than invent leases."
- **Property-name variants for the same building** — `"1234 Elm St"`, `"1234 Elm Street"`, and `"1234 Elm St."` all collapse to one Building via `normalizeBuildingName`. Without this, 45 units would land across 13+ `Building` rows and every per-building report would be wrong.
- **Duplicate tenant emails** (3 rows) — two tenants can legitimately share an email in Buildium (e.g., a corporate lease with the same AR contact). We import both tenants but only the first keeps the normalized email — the duplicate rows are preserved with `emailNormalized = null`, flagged, and visible in the preview.
- **Overlapping active leases** (74 warnings across 45 units) — two active leases on the same unit. Common during mid-month tenant swaps. Imported as-is with a flag; the rent roll can render both and highlight the overlap rather than silently discarding one.
- **UTF-8 and punctuation hygiene** — work-order descriptions in Spanish (`"Reparación de tubería en baño principal"`) and vendor names with apostrophes (`O'Malley & Sons`) round-trip cleanly because `papaparse` handles quoted CSV fields and Node is UTF-8 end-to-end.

Nothing is silently dropped. Every skip has a warning row with the external id, the field, and a one-line reason — the preview page renders them grouped by kind so the property manager sees the shape of the problem, not a 300-line JSON dump.

---

## NL-query destructive-query guardrail (Part 3)

Destructive SQL isn't filtered — it's structurally impossible. The LLM never produces SQL at all. It calls a single tool, `run_query`, whose input schema is a `QuerySpec` with four fields: an `entity` enum (8 pre-approved read-only surfaces), a `filters` array where each filter's `op` is a string enum of read-only comparators (`eq / neq / gt / gte / lt / lte / contains`), an optional `orderBy` with the same field restrictions, and a numeric `limit` capped at 100. There is no `sql`, `raw`, `query`, or `expression` field in the schema — the LLM cannot smuggle an imperative operation because there is no place to put one.

The executor (`executeQuery` in `src/lib/ai/nl-query.ts`) is a fixed switch over the entity enum. Each branch dispatches to `prisma.findMany` on a specific model or to one of the same pure aggregation functions the dashboard uses (`getRentRoll`, `getARAging`). Prisma mutation helpers (`create`, `update`, `delete`, `executeRaw`, `queryRawUnsafe`) are not imported into the executor module — if an attacker somehow supplied a QuerySpec that should trigger a mutation, the code to do it isn't there.

Three additional belts-and-braces checks run before any Prisma call: (1) zod `safeParse` rejects unknown operators or values that don't match the schema, (2) a per-entity `FIELD_ALLOWLIST` rejects field names outside a hand-written column subset (so `password_hash` could never be queried even if we accidentally added it to a model), and (3) the 100-row cap prevents runaway exfiltration. Failed validation returns a short explanation to the user, not a stack trace.

This is the "structured tool output, not generated SQL" pattern. It's the only NL-to-DB bridge I'd ship to production.

---

## W1 — Scraping + watermark/branding removal at scale

**Scraping stack.** Playwright runners behind a rotating residential IP pool (Bright Data / Oxylabs — residential beats datacenter on Cloudflare every time), orchestrated by BullMQ on Redis. Each source site gets its own worker type with its own rate limit, user-agent pool, and fingerprint profile (screen, TZ, WebGL). Change detection via ETag + content hash + structured-diff on the fields we care about (price, SF, availability) — we don't re-process a listing whose meaningful shape hasn't moved. Dedup across portals is hard and important: we key on `(normalized-address, floor, unit, SF±5%)` first, then run an LLM tiebreaker on descriptions when two candidate records otherwise match. Quality gates: schema validation, min-description-length, min-photos, no-broker-contact-only listings.

**Watermark/branding removal.** Three-layer pipeline. Layer 1 — template match known broker logos (CBRE, JLL, Cushman, Compass Commercial, every major boutique) against the corners/margins where they're always pasted. ~80% hit rate, near-zero false positives. Layer 2 — semantic segmentation (SAM 2) + inpainting (LaMa) for everything template match misses: diagonal watermarks, "SOLD" overlays, text stamps. Layer 3 — OCR (PaddleOCR) to catch text the first two layers missed, run inpainting a second pass. Quality gate: SSIM score vs. the input, blur detection around inpainted regions. Anything below threshold gets a human-in-loop task. Floor plans get a separate pipeline because broker annotations are structural — we OCR dimensions before we wipe text.

**What breaks at scale.** (a) Residential-IP quality decays over weeks as pools burn; we auto-retire flagged IPs. (b) Cloudflare Turnstile rolls out mid-quarter and breaks a worker silently — need canary listings that alert if we suddenly see 100% "try again" pages. (c) LaMa inpainting looks great on hero shots, mediocre on floor plans — we've caught it inventing plausible-but-wrong wall segments. (d) Broker templates change every 18 months.

**The legal dimension (call it out explicitly).** Scraping publicly-posted listing data in the US is contested but not obviously illegal post-*hiQ v. LinkedIn*; republishing watermarked media with the watermark removed is a different question. We should assume (1) CFAA risk if sites have explicit ToS prohibitions and login-gated content, (2) copyright risk on photos — the broker owns the photo, not the building owner, and we'd be making a derivative work by stripping branding, (3) database-rights claims from aggregators, (4) a real reputation risk with VTS/Loopnet specifically. My honest recommendation: scrape price/SF/address (factual, low-risk), license or re-commission the photos rather than scrape them, and ship a "broker-upload" flow that gets us the canonical media directly in exchange for lead routing. The clean-media pipeline becomes internal tooling for our own uploads, not a primary acquisition channel.

---

## W2 — Phase-2 QuickBooks replacement

**Day-1 schema decisions that matter.** Money as Int cents everywhere, so there's no decimal-coercion bug when we add a double-entry GL. `externalId` on every imported row, so reimports are deterministic and GL postings can reference source rows stably. Lease history as multiple rows rather than versioning in place, so point-in-time rent roll (required for month-end close) is a single `findFirst` with a date predicate. `accountRef` columns on Charge and Payment, null today, as the GL bolt-on point.

**Shortest honest list before a customer cancels QB.** (1) **Accrual + cash-basis reporting**, both, switchable at the report level. Most PM shops run cash, their CPAs want accrual. (2) **Bank reconciliation** — BAI/OFX import, auto-match, human resolve-exception workflow, month-end close checklist. Without this nothing is real. (3) **1099 e-filing** — vendor 1099-NEC and owner 1099-MISC, filed through an IRS-authorized agent (Track1099, Tax1099 integration). Getting this wrong once gets you dropped. (4) **Month-end close** — period locking, re-open with audit entry, closing-period checklist. (5) **Audit trail** — every edit becomes a reversing entry, never an in-place UPDATE. CPAs verify this by trying to edit a prior-month transaction. (6) **Trust accounting for security deposits**, per-state (FL §83.49, TX §92.102, CA Civ §1950.5 — each different). Regulated enough to be careful: I wouldn't promise trust-accounting compliance in marketing for year one — ship it off by default, enable per-state after legal review.

**Careful-about.** Trust accounting, 1099 e-filing, and anything touching rent-control jurisdictions (NYC, SF, LA). In year one, "QuickBooks replacement" should mean feature parity on reporting, bank rec, and close — not regulatory compliance claims that need a lawyer behind them.

---

## W3 — Extending AI beyond search

**One unified agent is the wrong answer.** It sounds clean but breaks at the first schema change — every new field tempts the agent into hallucinating a query surface that doesn't exist, and a single prompt has to reason about every domain (accounting, leasing, maintenance, vendor management). Better shape: **a handful of specialized tools behind a thin router**. The router is a 50-token classifier that picks which specialist handles the question; each specialist is a narrow tool with a tight schema and its own eval set.

**Concrete tools.** (1) `query_portfolio` — what we already have for Part 3, read-only QuerySpec over the dashboard's pre-aggregated views. (2) `forecast_cash_flow` — deterministic projection from the lease ledger with an AI layer that explains the deltas in English. (3) `draft_rent_roll_export` — scheduled or on-demand, generates a PDF/CSV snapshot as of a given date, emails it. This uses the same `getRentRoll` aggregation as the dashboard plus our existing auth layer. (4) `analyze_vendor_spend` — aggregate by vendor × category × trailing-12, surface outliers ("HVAC spend with Acme Mechanical is 2.4× the median for units this size"). (5) `lease_renewal_exposure` — "which tenants roll in Q3 and what's at risk" — joins renewal dates to current rent to market comp.

**Reliability as schema grows.** (a) A per-tool eval set — 50 question/answer pairs that the CI runs every release; regressions block deploy. (b) Tools are addressable via stable names, never free text — when a tool is deprecated we alias it with a warning. (c) Field allow-lists (same pattern as the NL guardrail) so adding a new column doesn't automatically expand the query surface. (d) Prompt caching on the tool manifest (5 min TTL).

**Where AI decides vs. helps.** AI *helps* with framing, summarizing, drafting, and flagging anomalies. AI *never decides* on anything that writes to the GL, posts a charge, sends money, or changes lease terms. Every action tool returns a proposal; a human clicks "approve." The line is: if it would appear in a court exhibit, a human has to sign off.

---

## W4 — AI-assisted floor-plan designer

**Three clean categories of problem.** *LLM-solvable*: intent parsing ("70% desks, 30% offices, plus a pantry and two phone booths" → a structured program brief), critique ("this plan has no path from reception to the main workspace without cutting through a private office"), and explanation ("here's why we put the pantry next to the kitchen corner plumbing riser"). These are language-in, language-out. *Geometric algorithms*: collision detection, space packing / bin-packing, adjacency-constraint satisfaction, corridor-width validation, egress-path checking, daylight optimization. These are solved problems in the architecture literature (Turner's space-syntax, CGAL for geometry). *UI/canvas*: a Figma-tier drag-drop, snap-grid, export pipeline — straight-up product engineering.

**What's realistic v1.** Start with *LLM critique of a human-drawn plan*. User drags rectangles in our canvas; our agent sees the plan through our own symbolic representation (not pixels) and offers specific, grounded feedback: "this conference room has no external wall — no daylight, 28 people rated but you have six desks too few for code egress width." The AI is a reviewer, not an author. This ships in 8–10 weeks and gets us real user feedback without betting the company on auto-layout.

**V2.** *Constrained generation from a brief.* The LLM emits a constraint graph (adjacencies, SF targets, ratios); a solver produces candidate layouts; the LLM ranks / critiques; user picks. This is the *right* architecture — don't let the LLM directly emit coordinates, it's bad at spatial reasoning.

**Research.** Free-form auto-layout that matches human taste on unusual programs (bio labs, law firms with asymmetric corner-office hierarchy). This is a thesis.

**Over-promising risk.** Saying "describe your office and we'll draw it" implies generation is solved. It is not — Gemini/Claude/GPT generating `<rect>` coordinates looks convincing in a demo and falls apart on the 11th room. If we market that, engineers quit and customers churn when the magic wears off. The honest pitch: "we help you design faster" — not "we design for you."

---

## W5 — Cost control at bootstrap scale

**Model routing.** Haiku 4.5 for classification, parsing, and NL-query routing. Sonnet 4.6 for synthesis and long-context reasoning (only where we can't factor the task down). Opus reserved for escalated cases and internal tooling. Routing done by a trained classifier (<50 tokens in, enum out) — NOT by a prose LLM call, which would eat the cost advantage.

**Prompt caching.** Our system prompt for `/search` is ~500 tokens; with `cache_control: { type: "ephemeral" }` and 5-min TTL, we pay 10% of input cost on cache hits. At 10k searches/month concentrated into working hours, hit rate realistically lands at 60–80%. That alone cuts our per-search input cost by 6–8×.

**RAG chunk size.** For building descriptions and market context, 300–500 token chunks with 50-token overlap is the sweet spot. Bigger chunks waste context window on irrelevant context; smaller chunks over-retrieve. Use a cross-encoder rerank on top of bi-encoder retrieval — you save context window and Sonnet spend.

**Supabase / Postgres.** Start on Neon free tier (3 GB, 191 compute hours/month), upgrade to Scale ($69/mo) at ~40k monthly searches when the compute ceiling starts being the limiter. Don't shard, don't plan for sharding — vertical scaling Postgres gets you past 1M searches/month if the queries are indexed.

**Hosting.** I chose to self-host the app on an Oracle Ampere VM behind Nginx + Certbot (the one this submission is actually deployed on) instead of Vercel. On Oracle's Always Free tier — 4 ARM cores, 24 GB RAM, 200 GB storage — the bill is genuinely $0/month through ~100k searches/month. Vercel Pro at the same traffic lands at ~$20 base plus bandwidth overage, and forces us off SQLite (serverless filesystems aren't persistent), adding a managed-Postgres line item we don't need yet. The Vercel-vs-self-host call is a $70–100/month swing at 100k searches and grows with the business; SSH access, no cold starts, and no function timeouts are free upsides.

**Self-host vs. managed for heavier services.** Stay managed through year one for anything that isn't the app itself. Self-hosting Playwright scrapers on Hetzner is $120/mo for 10 workers — cheaper than Browserless's $600/mo — but eats an FTE of infra time. Do it once AI API cost becomes >30% of spend, not before.

### Three Claude API cost traps I've seen engineers fall into

1. **Leaving the response cap open.** `max_tokens: 4096` on a classification task that should return 20 tokens. The model happily chews through the full 4096 sometimes — especially Sonnet under tool-use. Cap `max_tokens` to the actual expected output length. Cheapest defensive knob there is.

2. **Re-sending the whole conversation instead of using prompt caching.** Every turn of a multi-turn chat re-paying full-price input on the same 2k-token system prompt. At 10k sessions × 5 turns × 2k tokens × $3/M = $300/mo leaking that one change wouldn't cost a dime to fix. Adding `cache_control` on the system message is four characters of code for a 10× reduction in input spend.

3. **Using tool use for things that should be a plain completion.** Tool use tokens cost like output tokens, and the wrapper adds ~200 tokens of overhead per call. I've seen engineers reach for tool use on "does this listing look like a tech-startup space" — a boolean classifier that should be a plain `messages.create` returning one word. Rule of thumb: if the output has one degree of freedom, don't use tools.

### One-page cost projection

| Line item | 10k searches/mo | 50k searches/mo | 100k searches/mo |
|---|---:|---:|---:|
| LLM (Haiku 4.5 parse, Sonnet synth mix) w/ prompt caching | $42 | $195 | $380 |
| RAG rerank (Cohere rerank-3.5, 5 docs/query) | $8 | $40 | $80 |
| Image-processing pipeline (per-listing one-time; amortized) | $12 | $45 | $85 |
| App hosting (Oracle Ampere — Always Free tier through 100k) | $0 | $0 | $0 |
| Database (SQLite on-VM at ≤100k; Neon Scale when write contention hits) | $0 | $0 | $0 |
| CDN for media (Cloudflare R2 + Workers) | $10 | $28 | $52 |
| Observability (Sentry + a log tail, Team tiers) | $26 | $26 | $26 |
| Scraping infra (Playwright + residential IPs at Bright Data) | $180 | $360 | $640 |
| Email / transactional (Resend, Postmark) | $0 (free) | $25 | $25 |
| Misc (domains, secrets manager, backup storage) | $10 | $15 | $20 |
| **Total** | **$288** | **$734** | **$1,308** |
| _(Vercel Pro equivalent if we'd gone that route)_ | _+$20_ | _+$45_ | _+$68+$69 Postgres_ |

Caveats: assumes 60–80% prompt-cache hit rate; assumes <5% of searches escalate to Sonnet; assumes average 2.5 page-views per search session; does NOT include payroll or the AI floor-plan designer's compute (that's a separate P&L line once it exists). The self-hosted path saves roughly $20/mo at 10k and $140/mo at 100k versus a straightforward Vercel-Pro-plus-Neon stack, which is why I chose it for this submission's deploy.
