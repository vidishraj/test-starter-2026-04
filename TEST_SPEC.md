# RDE Advisors — Engineering Test: Full Spec

Read this before you start. The README has setup instructions; this file has the actual requirements.

---

## Context

You'd be the sole engineer reporting to Ross (founder, 20 years in NYC commercial real estate, non-technical). You'd ship two products from zero to one:

**1. Beyond the Space (BTS)** — NYC office search engine, competing with **VTS** and **Loopnet**. Aggregates office listings from scraped broker sites and portals. Bets: interaction, speed, visualization, AI. AI-assisted natural-language search, AI-assisted floor-plan tool, SEO that actually ranks.

**2. Property Management Platform** — competing with **Buildium, Appfolio, and Yardi**. Two halves of **equal importance (50/50)**:

- **Product build** — a PM platform with feature parity (tenants, leases, charges, payments, work orders, dashboards, rent roll, AR aging, cash flow, vendors, AI query).
- **Integration wedge** — "one-button import" from whichever competitor the customer is leaving.

An engineer who ships a world-class importer but a half-baked platform fails. So does one who ships a beautiful platform with no migration path. **Both halves count equally.**

QuickBooks replacement is phase 2. The day-1 schema must make phase 2 additive, not a rewrite.

**Current state.** Both products exist as prototypes running on a VPS. The PM platform operates on Ross's own portfolio (~$1.26M/mo rent, 14 active tenants). BTS has 548 listings across 76 buildings with live AI search. The starter repo uses the current Next.js App Router — you don't need to pin to v14.

---

## The Test — 5 Parts (205 min inside the 3.5 hr clock)

| Part | What | Suggested time |
|---|---|---:|
| 1 | BTS chat-first search (coding) | 55 min |
| 2 | PM one-button import (coding — INTEGRATION half) | 45 min |
| 3 | PM dashboard (coding — BUILD half) | 55 min |
| 4 | Written answers W1–W5 in `SUBMISSION.md` | 40 min |
| 5 | Loom walkthrough | 10 min |

A partial submission that shows judgment is better than a rushed, broken full submission. How you allocate time is part of what we grade.

---

### Part 1 — BTS chat-first search (~55 min)

Use `/data/listings.json` (25 synthetic NYC office listings) + `/public/images/listings/` + `/public/floorplans/`.

**The product is chat-first.** Homepage is a single textbox — "Describe your space" — with example chips like *"Tech startup in Hudson Yards"*, *"25 people in Midtown"*, *"10,000 SF in FiDi"*, *"Sublease near Penn Station"*. Submitting routes to `/search?q=...`. That page returns an AI response bubble at the top (short, conversational reply), a result count, and listing cards below. A separate `/listings` plain browse view is **optional** — only if time permits.

**Build three pages:**

**1. `/` (homepage).** Large textbox, hero headline, 4–6 example chips that pre-fill the box on click. Submits to `/search?q=...`. Server-rendered with real `<title>`, meta description, OG tags, and JSON-LD `WebSite` + `SearchAction` schema. This has to rank on Google.

**2. `/search?q=...` (chat-first results).** Server-rendered on first load. Single LLM call (Anthropic Claude preferred, tool use / structured output) returns (a) a short conversational response and (b) a structured filter `{submarket, sfMin, sfMax, features, subleaseOrDirect}`. Render: AI bubble at top → result count → listing cards → "Refine your search…" textbox that re-runs the query. Handle degraded states: LLM mis-parses → user refines; LLM returns no valid submarket → show all results with AI's explanation. **Don't ship a filter-sidebar results page — that's the wrong paradigm.**

**3. `/listings/[slug]` (detail view).** **Scrubbable hero media** — drag horizontally (or arrow keys) through photos + floor plan smoothly, like a native app (Airbnb/Zillow patterns). Preload adjacent images so scrubbing never stalls. Below: Space & Building Details, Floor Plan & Space Layout (SVG), Transit & Commute (fake data fine), Pricing. "Contact broker" CTA (dummy form fine). Slug format `{building-slug}-ste-{unit}-{hash}`. Clean `<title>` per listing via Next.js metadata template.

**We're measuring:** perceived speed, interaction taste, SEO hygiene (view-source content SSR'd, not a JS shell), graceful AI failure. The bar: "looks like a product we'd brag about," not "default Tailwind."

**Bonus (not required):** streaming AI response (don't block cards on streaming — render cards as soon as the structured filter resolves, stream the prose in parallel); dynamic `/office-space/[submarket]` SEO landing page; image loading strategy (blur-up, AVIF/WebP, responsive `sizes`).

---

### Part 2 — PM one-button import (~45 min) — INTEGRATION HALF

Use `/data/buildium_export.zip`: `tenants.csv`, `units.csv`, `leases.csv`, `charges.csv`, `payments.csv`, `work_orders.csv`. Intentionally messy — orphan records, inconsistent date formats, duplicates, charges referencing deleted leases. See the "Known quirks" section in `README.md` for the catalogue.

Buildium is the primary import path. Appfolio and Yardi exports are phase 2 — acknowledge them in `SUBMISSION.md` but don't build them.

**Build:**

1. **Schema.** Reasonable Prisma schema (SQLite is fine) for tenants, units, leases, scheduled charges, payments, work orders. Model relationships cleanly — not just the test data, a production schema. Think lease history, not just current tenant per unit.
2. **Accounting-aware, not accounting-complete.** Don't build a full double-entry GL here. But structure so phase-2 GL bolts on cleanly (charges/payments linkable to an eventual account reference). One paragraph in `SUBMISSION.md` on how you'd evolve this.
3. **The one-button experience at `/import`:**
   - Upload the zip or click "Try with sample data."
   - Progress view while import parses.
   - **Preview step** summarizing what will be imported: counts by entity, detected duplicates, orphaned/unmatched records, dates/amounts that failed to parse — clearly flagged, not silently dropped.
   - "Commit" button that actually writes it.
   - Success screen with counts + deep links to the tenant list / lease list.
4. **Idempotent.** Re-running the same import doesn't double-write.
5. **Edge cases.** Surface at least 2 from the data. Document in `SUBMISSION.md`.

If the preview step is a JSON dump, you've missed the point. Import UX is the day-1 wedge.

---

### Part 3 — PM dashboard (~55 min) — BUILD HALF

After import, the property manager needs to actually run their business in your platform. Build a minimal but polished dashboard at `/dashboard` with four features:

1. **Rent roll** — table of active leases: tenant name, unit, monthly rent, lease start/end, status (current / late / notice given). Sortable. CSV export.
2. **AR aging** — table or chart: 0–30 / 31–60 / 61–90 / 90+ days of outstanding charges. Click a row → tenant detail with payment history.
3. **Expense chart** — stacked bar or line: operating expenses by category (repairs, utilities, taxes, insurance, etc.) over the last 12 months. Synthetic fill is fine if the import doesn't cover expenses.
4. **Natural-language query bar** — "show me all tenants with past-due rent over $5,000," "vendors we paid more than $10,000 this year." Same pattern as BTS search (Anthropic tool use, structured output, safe query against your schema). **Guardrail:** no destructive queries (no DROP/DELETE/UPDATE/ALTER). Describe how you prevented it in `SUBMISSION.md`.

**We're measuring:** can you ship a PM feature that looks like Buildium/Appfolio/Yardi, not a table dump. PM domain thinking (what a property manager actually does on a Monday morning). Design consistency with Part 1. Whether the NL query is genuinely useful or a toy.

---

### Part 4 — Written answers (~40 min, in `SUBMISSION.md`)

Five prompts, **150–250 words each**. Specifics and opinions, not treatises. You're explicitly welcome to say "I don't know X, here's how I'd find out" — that reads as senior, not junior.

**W1. Scraping + watermark/branding removal at scale.** We aggregate office listings from VTS, Loopnet, and 30+ individual broker sites. Listings come with watermarked photos, broker-branded floor plans, and logo-stamped flyers. We need clean, consistent media with zero broker branding — automatically, at scale, not manually. Both halves are critical:

- **Scraping** — scheduling, change detection, anti-bot handling (residential IPs, Cloudflare cat-and-mouse, user-agent rotation, proxies, queue design), cross-portal dedup (same listing on 3+ sites = 1 record), data quality gates, stack choices.
- **Watermark/logo/branding removal pipeline** — template matching for known broker logos, segmentation + inpainting (SAM2 / LaMa / equivalent) for arbitrary watermarks, OCR to catch text overlays, quality gating so we don't ship garbage, human-in-loop fallback for edge cases. What breaks at scale? Flag the IP/legal dimension — there is one, we want to see you name it.

If you've done either of these at scale, tell us what bit you last time.

**W2. Phase-2 QuickBooks replacement.** Day 1 we coexist with QB; phase 2 we replace it. What must the day-1 schema get right so phase 2 isn't a rewrite? What's the shortest honest list of features a property-manager-grade accounting system must ship before a customer actually cancels QB (trust accounting per state for security deposits, 1099 e-filing, bank reconciliation, month-end close, CPA-friendly audit trail)? Which are regulated enough to be careful about promising in year one?

**W3. Extending the AI beyond search.** Part 3 has a natural-language query bar. How do you extend the same pattern across the PM surface? Cash flow questions ("what's my NOI trending?"), rent roll exports ("email me a rent roll as of last month"), lease renewal forecasting ("which tenants roll in Q3 and what's my exposure?"), vendor analysis ("am I overpaying for HVAC?"). What's the shape — one unified agent, or a handful of specialized tools? How do you keep it reliable as the schema grows? Where's the line between "AI helps" and "AI decides"?

**W4. AI-assisted floor plan designer (hardest product bet).** BTS's differentiating feature: tenants upload an existing plan and say "remove these desks, add three enclosed offices," or start blank with "7,000 SF, 70% desks, 30% enclosed, generous lounge, pantry, two phone booths." Which parts are LLM-solvable (intent parsing, critique), which are geometric algorithms (collision detection, space packing, constraint satisfaction), which are UI (drag-drop canvas, snap, export)? What's realistic for v1, what's v2, what's research? If you'd draw a different product line ("don't try auto-layout — let the LLM critique a human-drawn plan"), say so. Where's the over-promising risk?

**W5. Cost control at bootstrap scale.** You're running BTS on a tight bootstrap budget. Walk through how you'd keep monthly infra + AI API + third-party costs minimized across year one, assuming 10K monthly searches scaling to 100K. Give specific numbers where you can — model routing thresholds (Haiku for classification, Sonnet for synthesis), prompt caching TTL and hit-rate targets, Supabase tier ceilings, Vercel bandwidth math, when you'd self-host vs. stay managed, RAG chunk size trade-offs.

Name the **three biggest cost traps you've personally seen engineers fall into with the Claude API** — not generic advice, specific war stories. **Include a one-page table** in `SUBMISSION.md` projecting monthly spend at 10K, 50K, and 100K searches, broken down by line item (LLM, database, bandwidth, CDN, image processing, misc).

---

### Part 5 — Loom walkthrough (~10 min)

Record a Loom where you:
1. Open your live deploy and click through what you built.
2. Explain 2–3 specific trade-offs you made (what you cut, what you kept, why).
3. Tell us what you'd build next if this were week 1 on the job.
4. **"Explain this to a non-technical founder" segment (mandatory, ~60 seconds).** Ross is non-technical. In language anyone would understand — no jargon, no acronyms — explain what you built and why it matters for his business. This segment is graded separately and is required.

Do not narrate your entire codebase. We want your judgment on camera, not a tour.

---

## Also required in `SUBMISSION.md`

Beyond the 5 written answers:

- **200-word plain-English architecture overview** written for a non-technical founder. What you built, why it fits together this way, what it would take to scale to 10,000 users. No jargon. Ross will read this directly.
- **One-page cost projection table** (part of W5) for 10K / 50K / 100K monthly searches.
- **Phase-2 paragraph** (part of Part 2) on how your schema evolves to own the books.
- **Edge cases paragraph** (part of Part 2) documenting the 2+ edge cases you surfaced.
- **NL query guardrail paragraph** (part of Part 3) on how you prevented destructive queries.

---

## What we're looking for

- Sensible scoping under time pressure (shipping one thing well beats three things broken)
- **PM build and integration weighted equally** — don't punt on either half
- Data modeling judgment (Part 2 especially)
- Design taste (visual quality without a designer)
- Writing — `SUBMISSION.md`, README, and Loom narration
- Seeing the non-obvious problem (the watermark legal question, the phase-2 trust-accounting question, the specific cost traps)
- Communication with a non-technical founder (the mandatory Loom segment + the 200-word architecture overview)

We care less about:
- Test coverage (don't spend time here)
- Perfect lint / CI setup
- Over-polished pixel UI — "clean and thoughtful" beats "over-designed"

---

## Submission

When your 3.5 hours are up, email Ross (ross@rdeadvisors.com) with:

1. GitHub repo URL
2. Live deploy URL
3. Loom URL
4. PayPal / Wise / bank details for the $100 payment

Any questions before you start — reply to the test-send email and ask. Clarifying questions are a good signal.
