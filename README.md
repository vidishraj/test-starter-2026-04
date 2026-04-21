# Beyond the Space + PM platform slice

A timed engineering-test build for RDE Advisors: a chat-first NYC office search (BTS) plus a property-management platform with a Buildium one-button import, natural-language portfolio queries, and a rent-roll / AR-aging / expenses dashboard.

**[TEST_SPEC.md](./TEST_SPEC.md)** has the original brief. **[SUBMISSION.md](./SUBMISSION.md)** has the five written answers, the architecture overview, the cost projection, and the Decisions & Tradeoffs log (24 entries, each tied to a file).

---

## What ships

### Beyond the Space — `/`, `/search`, `/listings/[slug]`, `/office-space/[submarket]`

- **Homepage** — hero textbox with 6 example chips, SSR'd with JSON-LD `WebSite` + `SearchAction` structured data, OG tags, editorial serif display type. Works with JS disabled (chips fall back to direct form submission).
- **`/search?q=…`** — one-shot Claude Haiku 4.5 call with `tool_choice: "any"`, **streamed**: the filter resolves into a first Suspense boundary (cards render immediately), the conversational reply streams into a second boundary (typing-dots fallback). Graceful fallback to a heuristic parser when the API key is missing — visible notice, never silent.
- **`/listings/[slug]`** — SSG for all 25 listings (`generateStaticParams`), per-listing metadata via a template, **scrubbable hero** with pointer drag + arrow-key navigation + native `scroll-snap` + neighbor preload. No carousel library.
- **`/office-space/[submarket]`** — 10 SSG'd SEO landing pages, one per canonical submarket, with `ItemList` JSON-LD and mutual internal linking. `/office-space/grand-central` collapses the `"Grand Central"` / `"Grand Central Area"` data-entry variants onto a single URL.

### Property Management — `/import`, `/import/preview/[id]`, `/dashboard`, `/dashboard/tenants/[id]`

- **`/import`** — upload a Buildium export zip or "Try with sample data". Parses six CSVs (tenants, units, leases, charges, payments, work orders), cross-validates references, detects 10 distinct warning kinds, and stages the result in an `ImportRun` row before showing a preview.
- **Preview screen** — stat cards (total, will-import, will-skip per entity), key-findings (buildings detected, duplicate emails, orphaned refs), and a collapsed grouped warning list with a sample of rows per warning kind. Nothing is silently dropped. Running a commit twice produces zero new rows — every imported entity keys off a stable `externalId`.
- **`/dashboard`** — KPI strip, sortable rent roll with CSV export, AR aging (0-30 / 31-60 / 61-90 / 90+ buckets with per-tenant drill-in), hand-rolled SVG stacked-bar expense chart, natural-language query bar.
- **Natural-language query** — Claude returns a structured `QuerySpec`, never SQL. Executor is a fixed dispatch to `prisma.findMany` on 8 pre-approved read-only entities with a per-entity field allow-list and a 100-row limit cap. Destructive queries are structurally impossible — the full pattern is documented in `SUBMISSION.md` under "NL-query destructive-query guardrail".
- **Tenant detail** — running-balance payment history (charges increase, payments decrease), per-lease summary.

---

## Running locally

Prereqs: **Node 20.19+ or 22.12+** (Prisma 7 requires it).

**1. Create `.env` at the repo root.** `.env.example` is committed as a template.

```bash
cp .env.example .env
# then edit .env and set:
#   DATABASE_URL="file:./dev.db"
#   ANTHROPIC_API_KEY="sk-ant-..."   # optional — app falls back to a heuristic parser when absent
```

`DATABASE_URL` is read from `prisma.config.ts` → `process.env` (Prisma 7 moved this off `schema.prisma`).

**2. Install, migrate, run.**

```bash
npm install
npx prisma migrate dev --name init
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

**3. Load sample data.** Visit `/import` → "Try with sample data" → review the preview → "Commit". The dashboard at `/dashboard` now has 150 tenants, 122 active leases, 739 charges, 607 payments, and 60 work orders to play with.

---

## Deploying (self-hosted Oracle VM + Nginx + Certbot)

Target: an Oracle Cloud compute VM running Ubuntu 22.04 / 24.04 with a public IP and a DNS A record pointing at it. SQLite stays as the production database — a persistent-disk VM handles it fine, no Postgres swap required. Everything below is copy-pasteable for a deployment agent.

### Assumptions

| Item | Value |
|---|---|
| OS | Ubuntu 22.04 LTS or 24.04 LTS (Oracle Linux 9 works — swap `apt` for `dnf`, service names are the same) |
| Public DNS | e.g. `bts.example.com` pointing at the VM's public IP |
| App user | `deploy` (non-root, passwordless sudo for `systemctl` restart only) |
| App directory | `/srv/bts` (owned by `deploy`) |
| Data directory | `/var/lib/bts` (owned by `deploy`, holds `dev.db` + backups) |
| Node | 22 LTS via NodeSource |
| Reverse proxy | Nginx on 80/443 → Next.js on 127.0.0.1:3000 |
| TLS | Let's Encrypt via Certbot (auto-renew) |
| Process supervisor | systemd unit `bts.service` |

### Open the right ports

Two firewalls to mind on Oracle Cloud:

1. **VCN Security List / NSG** (Oracle Cloud Console → Networking): ingress rules for TCP 22 (from your admin IPs only), 80, 443. This one bites people — if ufw looks right but nothing reaches the box, it's the VCN.
2. **Host firewall** (`ufw`):
   ```bash
   sudo ufw allow OpenSSH
   sudo ufw allow 'Nginx Full'
   sudo ufw enable
   ```

Port 3000 stays closed to the public — Nginx is the only thing that talks to it.

### Install the base stack

```bash
# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential git nginx

# better-sqlite3 native module builds against libsqlite
sudo apt-get install -y libsqlite3-dev

# Certbot via snap (official recommendation)
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
```

### Clone, env, install, migrate, build

Run as the `deploy` user:

```bash
sudo install -d -o deploy -g deploy /srv/bts /var/lib/bts
cd /srv/bts
git clone <your-git-remote> .

cat > .env <<'EOF'
DATABASE_URL="file:/var/lib/bts/prod.db"
ANTHROPIC_API_KEY="sk-ant-..."
NODE_ENV=production
PORT=3000
EOF
chmod 600 .env

npm ci
npx prisma migrate deploy
npm run build
```

The SQLite file lives at `/var/lib/bts/prod.db`, **outside the repo**, so `git pull` can't touch it. Keep `/var/lib/bts` on a volume with snapshots enabled — that's the backup strategy.

### systemd unit

`/etc/systemd/system/bts.service`:

```ini
[Unit]
Description=Beyond the Space (Next.js)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=deploy
Group=deploy
WorkingDirectory=/srv/bts
EnvironmentFile=/srv/bts/.env
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=3
# Harden a bit
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=/var/lib/bts /srv/bts/.next
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bts.service
sudo systemctl status bts.service
# tail logs:
journalctl -u bts -f
```

### Nginx reverse proxy

`/etc/nginx/sites-available/bts.conf`:

```nginx
# Redirect HTTP to HTTPS (certbot adds the 443 block below)
server {
    listen 80;
    listen [::]:80;
    server_name bts.example.com;

    # Let certbot answer ACME challenges before redirect
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name bts.example.com;

    # Certbot will populate ssl_certificate / ssl_certificate_key below.

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Next.js serves its own static assets with immutable cache headers;
    # proxy everything to the app. No asset passthrough needed.
    client_max_body_size 20M;   # Buildium export zip uploads

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript application/xml+rss image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }
}
```

Enable it:

```bash
sudo ln -sf /etc/nginx/sites-available/bts.conf /etc/nginx/sites-enabled/bts.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### TLS via Certbot

```bash
sudo certbot --nginx -d bts.example.com --non-interactive --agree-tos -m you@example.com --redirect
```

Certbot fills in the `ssl_certificate` / `ssl_certificate_key` lines and installs a timer for automatic renewal. Verify:

```bash
sudo certbot renew --dry-run
sudo systemctl list-timers | grep certbot
```

### Smoke test the live URL

```bash
curl -I https://bts.example.com/                        # 200
curl -s https://bts.example.com/ | grep -o 'SearchAction'  # JSON-LD present
curl -I https://bts.example.com/dashboard               # 200
```

Visit `/import` in a browser → "Try with sample data" → commit. `/dashboard` now has 150 tenants, 122 leases, etc. to render against.

### Updating deploys

Run as `deploy`:

```bash
cd /srv/bts
git pull --ff-only
npm ci
npx prisma migrate deploy
npm run build
sudo systemctl restart bts.service
```

Wrap those six lines in a `deploy.sh` if you want. For zero-downtime, add a second Next.js instance on :3001 and swap the Nginx `proxy_pass` — not needed for this test, but the `bts.service` unit is easy to duplicate.

### Backups

The SQLite file at `/var/lib/bts/prod.db` is the only piece of state. Two options, both fine:

1. **Oracle Block Volume snapshots** of the volume holding `/var/lib/bts`, scheduled daily.
2. **Application-level dump** with SQLite's `.backup`:
   ```bash
   sqlite3 /var/lib/bts/prod.db ".backup /var/lib/bts/backups/prod-$(date +%F).db"
   ```
   Drive this from a cron entry on the `deploy` user; keep 14 days rolling.

SQLite's `.backup` is crash-safe while the app is writing. `cp` on a live DB is not.

### Hand-off checklist for the deployment agent

- [ ] DNS A record → VM public IP, propagated
- [ ] VCN ingress open for 22 (admin CIDR), 80, 443
- [ ] `deploy` user exists with sudo for `systemctl restart bts`
- [ ] `.env` at `/srv/bts/.env` has `DATABASE_URL`, `ANTHROPIC_API_KEY`, `NODE_ENV=production`, `PORT=3000`; file mode `600`, owned by `deploy`
- [ ] `/var/lib/bts` exists, owned by `deploy`, backed by a snapshot-enabled volume
- [ ] `bts.service` enabled, running, restarts on failure
- [ ] Nginx `bts.conf` valid (`nginx -t`), HTTP→HTTPS redirect live
- [ ] Certbot cert installed, renew timer active
- [ ] Public URL serves `/`, `/search?q=test`, `/dashboard`, `/import` with 200
- [ ] JSON-LD present in `/` view-source
- [ ] Sample import committed, dashboard populated

---

## Architecture at a glance

```
src/
  app/
    page.tsx                      homepage
    search/page.tsx               /search — Suspense-streamed AI search
    listings/[slug]/              SSG listing detail + scrubbable hero
    office-space/[submarket]/     SEO landing pages (10 SSG)
    import/                       /import + preview + done + server actions
    dashboard/                    /dashboard + rent roll + AR aging + tenants/[id]
  components/                     presentational pieces shared across pages
  lib/
    listings.ts                   data layer for BTS (types, filter, normalization, slugs)
    ai/search.ts                  BTS streaming search (Claude tool use)
    ai/nl-query.ts                NL portfolio query (structured QuerySpec executor)
    dashboard/metrics.ts          rent roll, AR aging, KPIs, expense aggregations
    import/buildium.ts            zip + CSV parser with cross-file validation
    import/commit.ts              idempotent upsert pipeline
    db.ts                         Prisma singleton
prisma/
  schema.prisma                   8 models: Building, Unit, Tenant, Lease, Charge,
                                  Payment, WorkOrder, ImportRun
```

Stack: Next.js 16 (App Router), React 19, Prisma 7 (better-sqlite3 driver adapter), Tailwind 4, TypeScript 5, Claude Haiku 4.5 via `@anthropic-ai/sdk`, `papaparse` + `jszip` for imports.

---

## What I deliberately didn't build

- Authentication / multi-tenant isolation — out of scope for a timed test; for production, Clerk or Auth.js with a `tenantId` column on every model.
- Full double-entry GL (discussed as the phase-2 evolution in `SUBMISSION.md` — the schema leaves `accountRef` columns as the bolt-on point).
- CRUD endpoints for Tenants / Leases / Charges — the dashboard is read-first; data enters via the Buildium importer.
- Appfolio / Yardi import (spec calls this out as phase 2; the parser architecture is designed so a second source file becomes a new parse module + a branch in the stage action).
- Auth on the NL query (single-user demo); in production, rate-limit per user and redact PII fields on the way back.
- Test coverage — spec explicitly called this out as low-priority. Aggregations in `src/lib/dashboard/metrics.ts` and `src/lib/import/buildium.ts` are pure and easy to cover in follow-up.

See `SUBMISSION.md` for the full 24-entry Decisions & Tradeoffs log.
