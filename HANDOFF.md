# Handoff — QSA Industries ERP (local MySQL migration)

## Status
Local migration from database/PostgreSQL to XAMPP/MySQL is **functionally complete for auth, core reads, and all component-level mutations**. The app runs locally and login works. UI has been re-themed to the CoreERP neumorphic design. Remaining gap: Postgres view-based analytics reads return empty lists (non-crashing).

## How to run

### Prerequisites
- XAMPP installed at `C:\xampp` (MariaDB 10.11 + Apache + phpMyAdmin).
- Node.js v26+.
- Project at `D:\PROJECTS+\QSAINDUSTRIES\QSAINDUSTRIES`.

### Start services
```powershell
Start-Process -FilePath "C:\xampp\mysql\bin\mysqld.exe" -ArgumentList "--defaults-file=C:\xampp\mysql\bin\my.ini" -WindowStyle Hidden
Start-Process -FilePath "C:\xampp\apache\bin\httpd.exe" -WindowStyle Hidden
```

### Start app
```powershell
cd D:\PROJECTS+\QSAINDUSTRIES\QSAINDUSTRIES\web
npm run dev
```
App: http://localhost:3000  (login: http://localhost:3000/login)
phpMyAdmin: http://localhost/phpmyadmin

## Credentials
- App login password (all demo accounts): `Qsa@Demo2026`
- Demo accounts: admin@qsa-demo.in, operations.production@qsa-demo.in, operations.inventory@qsa-demo.in, qc@qsa-demo.in, logistics@qsa-demo.in, finance@qsa-demo.in, nadia.kapoor@qsa-demo.in, meera.nair@qsa-demo.in, ravi.menon@qsa-demo.in, dealer@qsa-demo.in
- MySQL: host localhost:3306, database `qsa_erp`, user `qsa_user` / `Qsa@Demo2026` (root has no password)

## Architecture (local mode)
- `web/src/lib/db.ts` — mysql2 pool (env: MYSQL_HOST/PORT/USER/PASSWORD/DATABASE, defaults for XAMPP). `dateStrings: true` so DATE columns arrive as strings.
- `web/src/lib/auth.ts` — cookie-based session (`qsa_session`), `getProfile()` reads `users` table.
- `web/src/app/api/auth/login|logout` — bcrypt verify + cookie set/clear.
- `web/src/lib/database/server.ts` & `client.ts` — shims returning chainable builders that resolve to `{data:[], error:null}` (so unmigrated reads don't crash).
- `web/src/proxy.ts` — pass-through (no auth middleware; pages guard via `requireProfile`).
- Each migrated module has dedicated routes under `web/src/app/api/...`.

## Database
- MySQL database `qsa_erp` with core tables: users, dealers, products, price_lists, orders, order_items, invoices, payments, stock_levels, stock_movements, production_runs, production_batches, purchase_orders, purchase_order_lines, finance_settings, expense_heads, expense_ledger, designations, org_positions, dealer_onboardings, tally_exports.
- `users.password_hash` column holds bcrypt hashes (all demo accounts use `Qsa@Demo2026`).
- `users.reports_to_id` column added for org chart.
- Note (review): `dealer_onboardings` and `tally_exports` were missing from the initial XAMPP import and have been recreated. The tally export route now writes an audit row to `tally_exports` (row count + sha256). The dealer onboarding "start" action now creates the dealer row (previously it only inserted an onboarding row with a null dealer id). The dead "Export"/"Create new" placeholder buttons were removed from the page header. Overview dashboard reads (inventory aging, production summary/daily/yield, status summary, stage funnel) and getRawMaterials are now ported to MySQL so seeded data renders. Dummy dataset seeded (products, dealers, orders, invoices, payments, stock, production runs/batches, purchase orders, expenses, designations, org positions). Org chart: added `designation_id`/`sort_order` columns to `users`, set reporting lines and designations for all staff, and ported `getOrgPeople` to MySQL so the full staff tree renders. Added 19 more staff across production, quality, inventory, logistics, finance, sales and HR (29 total) so every department is populated. Generated 27 PDF reference guides in docs/guides/ covering every data-entry section.

## UI
- Re-themed to CoreERP neumorphic design: DM Sans + Manrope fonts, soft-shadow surfaces, 248px sidebar, top bar with search/notifications/profile, greeting heading, KPI cards.
- `web/src/app/globals.css` — CoreERP theme variables and neumorphic helpers.
- `web/src/components/portal-shell.tsx` — CoreERP layout shell.
- `web/src/components/portal-nav.tsx` — sidebar nav.
- `web/src/components/sidebar-nav-scroll.tsx` — preserves sidebar scroll position and scrolls active item into view.

## Settings page
- `/internal/settings` (admin only) consolidates ageing/credit settings, Tally export, and portal management quick links.
- Nav order: Overview, Inventory, Purchasing, Production, Quality, Finance, Dispatch queue, Delivery board, Organization, Dealer onboarding, Sales orders, Reporting, Settings.

## Tally integration
- CSV exporter at `GET /api/tally/export?from=&to=` (finance/admin only).
- Finance page and Settings page have "Download Tally CSV" buttons.
- Each export recorded in `tally_exports` audit table (row count + sha256 checksum).
- Open Tally-side decisions (from `docs/TALLY_EXPORT.md`): voucher type, ledger name mapping, GST split (CGST/SGST), voucher numbering, XML format, period convention. No XML generated yet.
- To integrate: export CSV, then convert to Tally XML (Sales/Receipt vouchers) and import via Gateway of Tally → Import, or push via Tally ODBC/HTTP (port 9000).

## What is migrated (100% of component-level mutations)
Auth, core reads, expenses, admin products/dealers, designations, finance settings, stock adjustments, delivery confirm, production runs, QC, order actions (approve/escalate/director/dispatch), order create/edit, proxy orders, generate invoice, dealer/invoice payments, dealer credit, dealer assignment, dealer onboarding (all actions), price lists, admin users (profile + password + create), org chart builder, org people builder, super-admin, staff login, batch receive, purchase orders (create + receive), dealer login provisioning, dealer catalog, tally export.

## Remaining gap (read-only analytics)
Postgres views/RPCs not ported to MySQL; these screens show empty data but don't crash:
- Regional sales reporting views and date-range functions.
- Dashboard aggregation views (production summary/yield, inventory aging, credit exposure, dealer onboarding board, sales daily split, stage funnel, dealer rep coverage, sales rep dealers, delivery board, user directory, org chart/people tree, expiring batches, dealer invoice ageing).

Porting these means recreating the views as MySQL views or inline SQL in `lib/data.ts`. All are SELECT-only and can be done incrementally.

## Key files changed
- `web/src/lib/db.ts`, `web/src/lib/auth.ts`
- `web/src/lib/database/server.ts`, `web/src/lib/database/client.ts`
- `web/src/proxy.ts`
- `web/src/components/*` (all mutation components updated to fetch local API; portal-shell, portal-nav, sidebar-nav-scroll, data-panel)
- `web/src/lib/data.ts` (core reads migrated; views return empty)
- `web/src/app/api/**` (new local API routes including settings, dealer-catalog, batches, purchase-orders, org, dealer-login)
- `web/src/app/internal/settings/page.tsx` (new)
- `web/src/app/internal/page.tsx` (card alignment)
- `web/.env.local` (added MYSQL_* vars)
- `web/src/app/globals.css` (CoreERP theme)

## Notes for next engineer
- The app no longer contacts database; all data is local MySQL.
- Business logic from Postgres SECURITY DEFINER functions was simplified in the API routes (credit checks, stock triggers, etc. are basic writes). For production parity, re-add validations.
- `npm run build` / `npm run typecheck` should pass (`npx tsc --noEmit` clean).
- MySQL must be running before `npm run dev`.
- If the dev server shows "Objects are not valid as a React child (Date)", ensure `dateStrings: true` in db.ts pool (already set).
- If MySQL user `qsa_user` access is denied, recreate via `mysql -u root < user2.sql`.
- Finance "Expense spend" card NaN fixed: getExpenseLedger/getExpenseTotals now derive net_amount and is_void from voided_at.
- 27 PDF reference guides served at /guides/*.pdf; "PDF Help" link added to every data-entry form and collapsible panel.
- Manual sales orders: POST /api/orders/manual creates an order for an existing dealer with custom lines/prices/status.
- Manual invoices: POST /api/invoices/manual creates an invoice for an existing dealer (order_id nullable); forms added to Sales/Orders and Finance pages.
- Security hardening: session cookie now HMAC-signed (forged raw-id cookies rejected); login rate-limited (5 attempts/15min per IP); CSRF mitigation via Origin check in proxy middleware; login backdoor removed; cookie secure flag in production; sales_rep_id resolved from dealer on dealer orders; role-based authorization (403) on all 34 API routes.
- Server-side input validation added to key routes (products, dealers, users, stock adjust, production runs, expenses, finance settings, manual orders/invoices): required fields, numeric ranges, enum values, email/HSN format.
