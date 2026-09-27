# QSA ERP — 10-Day Stage-Wise Build Plan (Supabase)

## How to use this document

Each day below is a **self-contained prompt** you can copy-paste directly into opencode (or any AI coding agent) once you've created the Supabase project and have your credentials ready. Build and test each day's deliverable before moving to the next — don't skip ahead, since later stages depend on earlier schema and auth decisions.

**Before Day 1:**

1. Create a new Supabase project
2. Note down: Project URL, `anon` public key, `service_role` key, and Postgres connection string
3. Have these ready to hand to opencode when you start Day 1

Each prompt below assumes opencode has read/write access to your Supabase project (via credentials or Supabase MCP/CLI) and can create tables, RLS policies, and a Next.js (or your chosen framework) frontend connected to Supabase.

## Day 1 — Supabase Schema Foundation

> **Prompt for opencode:**
>
> I'm building an ERP for a poultry feed manufacturer (QSA Industries) using Supabase as the backend. Set up the foundational database schema in Supabase. Create these tables with appropriate columns, primary/foreign keys, and constraints:
>
> - `users` (linked to Supabase Auth `auth.users`, with `role` enum: admin, production\_manager, inventory\_manager, sales\_rep, sales\_manager, sales\_director, logistics, finance, dealer)
> - `user_hierarchy` (maps sales\_rep → sales\_manager → sales\_director, with `manager_id` self-referencing `users`)
> - `dealers` (name, contact info, address, credit\_limit\_override if any, mapped `sales_rep_id`, status)
> - `products` (SKU, name, category, unit of measure, price, active flag)
> - `price_lists` (optional: dealer-specific or tier-based pricing, product\_id, dealer\_id or tier, price)
>
> Requirements:
>
> - Use UUID primary keys
> - Add `created_at` / `updated_at` timestamps on every table
> - Write this as Supabase migration SQL files (not just describing it)
> - Do NOT set up Row Level Security policies yet — that's tomorrow's task
> - Seed a few sample rows (2-3 dealers, 5 products, 1 admin user, 1 sales director, 2 managers, 4 reps) so I can verify the schema visually in Supabase Table Editor
>
> Deliverable: migration files applied to my Supabase project + a short summary of the schema (table names, key relationships) so I can verify it before Day 2.

**Acceptance check before moving on:** open Supabase Table Editor and confirm all 4-5 tables exist with sample data and correct foreign keys.

## Day 2 — Auth & Role-Based Access (RBAC)

> **Prompt for opencode:**
>
> Using the schema from Day 1, set up authentication and role-based access control across the three portals (Internal Operations, Sales & Management, Dealer) using Supabase Auth.
>
> Requirements:
>
> - Configure Supabase Auth for email/password login
> - On signup/user creation, link `auth.users` to our `users` table with the correct `role`
> - Write Row Level Security (RLS) policies so:
>   - Dealers can only see/edit their own dealer record and their own orders (once orders exist)
>   - Sales reps can only see dealers/orders mapped to them
>   - Sales managers can see all reps/dealers/orders under them (use `user_hierarchy`)
>   - Sales director can see everything under sales
>   - Admin/production/inventory roles can see their respective data, enforced separately from sales data
> - Build 3 separate login pages/apps (or 3 route groups in one app) — Internal, Sales, Dealer — each redirecting to role-appropriate views after login
> - Add a simple "logged in as \[role\]" indicator on each portal for testing
>
> Deliverable: working login for each portal, with RLS policies enforced (test by logging in as a dealer and confirming you cannot see other dealers' data).

**Acceptance check before moving on:** create 2 test dealer logins and confirm each can only see their own data; confirm a sales manager can see their reps' dealers but not other managers'.

## Day 3 — Inventory Module

> **Prompt for opencode:**
>
> Build the inventory module on top of the existing Supabase schema.
>
> Requirements:
>
> - Create tables: `stock_levels` (product\_id, current\_quantity, unit), `stock_movements` (product\_id, quantity, movement\_type: in/out, source: production/sales/adjustment, reference\_id, created\_by, created\_at)
> - Every stock movement should update `stock_levels` automatically (use a Postgres trigger or Supabase Edge Function)
> - Build an Internal Portal screen (Inventory Manager role) to: view current stock levels for all products, manually add a stock adjustment (in/out) with a reason, view stock movement history per product
> - Add a low-stock threshold field per product and flag products below it visually
> - Expose current stock levels as a query/view the Dealer Portal catalog will use later (real-time, so use Supabase real-time subscriptions or simple polling)
>
> Deliverable: working Inventory screen in the Internal Portal where I can add a manual stock-in, see the level update immediately, and see it reflected in stock\_movements history.

**Acceptance check before moving on:** add a manual stock-in and stock-out, confirm `stock_levels` updates correctly and movement history is accurate.

## Day 4 — Production Module (Continuous Process)

> **Prompt for opencode:**
>
> Build the production module for continuous-process feed manufacturing.
>
> Requirements:
>
> - Create tables: `production_runs` (date/shift, product\_id output, quantity\_produced, raw\_materials\_used as JSON or a linked `production_run_materials` table, qc\_status, qc\_notes, created\_by), `raw_materials` (name, unit) if not already covered by `products`
> - Building an Internal Portal screen (Production Manager role) to: log a production run (date/shift, output quantity, raw materials consumed), mark a basic QC pass/fail with notes
> - On saving a production run: automatically create a `stock_movements` entry (type: in) for the finished product, and stock-out entries for raw materials consumed — reuse Day 3's stock logic
> - Build a simple production yield view: total output vs raw material input, by day/period
>
> Deliverable: working Production screen where logging a run updates finished-goods stock (in) and raw-material stock (out) automatically, with a yield report visible.

**Acceptance check before moving on:** log a production run and confirm both `stock_movements` and `stock_levels` reflect it correctly for both output and raw materials.

## Day 5 — Dealer Portal: Catalog & Order Placement

> **Prompt for opencode:**
>
> Build the Dealer Portal's product catalog and order placement flow.
>
> Requirements:
>
> - Create tables: `orders` (dealer\_id, sales\_rep\_id, status enum: pending/approved/dispatched/invoiced/rejected, total\_amount, created\_at), `order_items` (order\_id, product\_id, quantity, unit\_price)
> - Build a catalog page showing all active products with real-time stock availability (pull from `stock_levels` built on Day 3) and dealer-specific pricing if set (from `price_lists`)
> - Build an order form: dealer selects products + quantities, sees a running total, submits
> - On submit: create an `orders` row (status: pending) + `order_items`, auto-fill `sales_rep_id` from the dealer's mapped rep
> - Build a "My Orders" list for the dealer showing status and order history
>
> Deliverable: a dealer can log in, browse the catalog with live stock, place an order, and see it appear in their order history as "Pending".

**Acceptance check before moving on:** log in as a test dealer, place an order, confirm it's saved correctly with the right rep auto-assigned and correct line items.

## Day 6 — Sales Rep + Manager Order Workflow & Credit Check

> **Prompt for opencode:**
>
> Build the sales-side order review workflow with dynamic credit-limit checking.
>
> Requirements:
>
> - Create a `credit_limits` table or view: calculate a dealer's available credit as `credit_limit - sum(outstanding invoice amounts)` (outstanding = invoiced but not fully paid; for now, since invoicing doesn't exist yet, stub it as `credit_limit - sum(pending/approved order totals)` and note it'll be refined on Day 8)
> - Build a Sales Rep screen: list of pending orders from their mapped dealers, ability to review and forward to manager (or auto-forward on submit)
> - Build a Sales Manager screen: queue of orders pending approval from their mapped reps, showing dealer's current credit exposure vs limit
> - If order total + existing exposure is within the limit: manager can approve directly
> - If it exceeds the limit: require a mandatory text remark to override, log the override (who, when, why) in an `order_approvals` table, and set order status to approved with an `override:true` flag
> - Add an "escalate to director" action instead of override, which sets status to `pending_director_approval`
>
> Deliverable: a manager can see a pending order with credit info, approve normally, or override with a remark, and status updates correctly to "Approved".

**Acceptance check before moving on:** place a test order that exceeds a dealer's credit limit, confirm the manager sees a warning and can only proceed via override (with remark) or escalation.

## Day 7 — Director Escalation, Dispatch & Full Order Status Tracking

> **Prompt for opencode:**
>
> Complete the order lifecycle: director escalation, dispatch, and end-to-end status tracking.
>
> Requirements:
>
> - Build a Sales Director screen: queue of orders with `pending_director_approval` status, ability to approve or reject with remark
> - Build a Logistics/Dispatch screen: list of approved orders ready to dispatch, action to mark "Dispatched" (with optional dispatch date/tracking note)
> - Update the `orders.status` enum to fully support: pending → approved → dispatched → invoiced (and rejected as an end state)
> - Update the Dealer Portal's "My Orders" view to show this full status progression clearly (e.g. a stepper or timeline)
> - Add a combined "Sales Director dashboard" showing orders by status across all managers/reps (a simple table/count view is enough for now — full analytics comes Day 9)
>
> Deliverable: an order can flow from dealer placement → rep → manager (approve/override/escalate) → director (if escalated) → dispatch, with the dealer seeing correct status at every step.

**Acceptance check before moving on:** run one full order end-to-end (place → approve → dispatch) and one escalated order (place → exceeds limit → escalate → director approves → dispatch), confirming dealer status updates correctly both times.

## Day 8 — Invoicing (GST) & Dealer Ledgers

> **Prompt for opencode:**
>
> Build the invoicing and dealer ledger module.
>
> Requirements:
>
> - Create tables: `invoices` (order\_id, dealer\_id, invoice\_number, gst\_amount, taxable\_amount, total\_amount, invoice\_date, created\_by), `payments` (invoice\_id or dealer\_id, amount, payment\_date, mode, recorded\_by)
> - Build a Finance/Accounts screen: list of dispatched orders not yet invoiced, a "Generate Invoice" action (manual trigger, not automatic) that creates an `invoices` row with a sequential GST-compliant invoice number and correct tax breakup (assume a flat GST % for now, configurable)
> - On invoice generation, update `orders.status` to "invoiced"
> - Build a dealer ledger view (Finance screen): per dealer, list invoices, payments received, and running outstanding balance
> - Add a "Record Payment" action against an invoice or dealer (supports partial payments)
> - Replace the Day 6 credit-limit stub with the real calculation: `credit_limit - sum(unpaid/partially-paid invoice amounts)`
> - Add the dealer's outstanding balance to their Dealer Portal view
>
> Deliverable: finance can generate a GST invoice for a dispatched order, record a partial payment, and see the dealer's real credit exposure update accordingly.

**Acceptance check before moving on:** generate an invoice, record a partial payment, confirm the dealer's outstanding balance and available credit limit both update correctly.

## Day 9 — Dashboards & Reporting

> **Prompt for opencode:**
>
> Build reporting dashboards using the data accumulated in the previous stages.
>
> Requirements:
>
> - Sales Director / Manager dashboard: sales trends over time (by day/week/month), orders by status, top dealers by volume, credit exposure by dealer
> - Inventory dashboard: current stock levels, low-stock products, stock movement trends
> - Production dashboard: yield trends (output vs raw material input) over time
> - Use Supabase views or materialized views for aggregations where it makes sense, and a charting library (e.g. Recharts) on the frontend
> - Make sure each dashboard respects the RBAC set up on Day 2 (a manager only sees their team's data, director sees all sales data, etc.)
>
> Deliverable: three role-appropriate dashboards (sales, inventory, production) showing real data from the system built so far.

**Acceptance check before moving on:** confirm dashboard numbers match what's actually in the database (spot-check a couple of totals manually).

## Day 10 — Tally Export Prep, QA & Deployment

> **Prompt for opencode:**
>
> Finish the project with Tally integration prep, testing, and deployment to production.
>
> Requirements:
>
> - Build a Tally export function: generate invoices and payments in a format Tally can import (CSV/XML per Tally's import spec — ask me for QSA's exact Tally version/format if unknown, and stub the exact mapping as a TODO)
> - Run through every workflow end-to-end once more: dealer order → rep → manager approval/override → director escalation → dispatch → invoice → payment → dashboard reflects it
> - Fix any bugs found; tighten RLS policies (test that no role can see data outside its scope)
> - Set up environment variables/secrets properly (no hardcoded Supabase keys in the frontend beyond the public `anon` key)
> - Deploy the application to the Hostinger VPS (set up Node/Next.js process manager e.g. PM2, reverse proxy e.g. Nginx, HTTPS via Let's Encrypt)
> - Provide a short README covering: how to deploy updates, environment variables needed, and default admin login
>
> Deliverable: the full system live on the Hostinger VPS, accessible via a domain/IP, with all three portals working end-to-end.

**Acceptance check before moving on:** access all three portals from outside your local network, log in with each role, and run one full order end-to-end on the live deployment.
