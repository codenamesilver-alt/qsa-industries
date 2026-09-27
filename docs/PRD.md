# QSA Industries ERP — Product Requirements Document

Sep 24, 2026 · Prepared by @Syed Moosi Raza Abidi

## 1. Overview

QSA Industries is a manufacturer of poultry feed products operating from a single site/factory. This document defines requirements for a custom ERP system covering inventory, continuous-process production, sales order management, and invoicing — accessed through three separate portals:

- **Internal Operations Portal** — for production, inventory, and back-office staff
- **Sales & Management Portal** — for sales reps, managers, sales director, logistics/dispatch, and finance/accounts approvers
- **Dealer Portal** — for dealers to browse the product catalog and place orders

The system will run on a Hostinger VPS and integrate with the existing Tally accounting setup (Tally remains the system of record for accounting; this ERP will not replace it).

## 2. Goals & Success Criteria

- Replace manual/Excel-based coordination between sales, production, and inventory with a single source of truth
- Give dealers a self-service ordering channel that reduces phone/WhatsApp order-taking
- Enforce credit discipline automatically while still allowing controlled manager overrides
- Give management (managers, sales director) visibility into orders, credit exposure, stock, and production output without chasing reports
- Keep Tally as the accounting system of record; the ERP feeds it rather than duplicating it
- Deliver the system in clearly scoped phases so each phase can go live and be used before the next begins

## 3. User Roles, Hierarchy & Permissions

### 3.1 Reporting hierarchy

- Multiple **Sales Reps** report to one **Sales Manager**
- Multiple **Sales Managers** report to one **Sales Director**
- **Dealers** are each mapped to one primary Sales Rep

### 3.2 Roles across the three portals

| Portal | Roles |
| --- | --- |
| Internal Operations | Admin, Production Manager, Inventory Manager, (optionally QC staff) |
| Sales & Management | Sales Rep, Sales Manager, Sales Director, Logistics/Dispatch, Finance/Accounts Approver |
| Dealer | Dealer (single login per dealer account) |

### 3.3 Permissions summary

| Role | Key permissions |
| --- | --- |
| Dealer | Browse catalog with live stock, place orders, track order status, view own ledger/outstanding |
| Sales Rep | Receive/view orders from mapped dealers, create orders on behalf of dealers, view own dealers' credit status |
| Sales Manager | Review orders from mapped reps, approve/reject, check & override credit limit (with remark) |
| Sales Director | Dashboard/reporting across all managers and reps, approve escalated/overridden orders |
| Logistics/Dispatch | View approved orders, update dispatch status, mark shipped/delivered |
| Finance/Accounts Approver | Manually trigger GST invoices, manage dealer ledgers and payments |
| Production Manager | Manage production runs/output, raw material consumption |
| Inventory Manager | Manage stock levels, stock in/out, link to production and sales |
| Admin | Full access, user/role management, master data (products, dealers, price lists) |

## 4. Portal 1 — Internal Operations Portal

Used by Admin, Production Manager, and Inventory Manager. Role-based views/dashboards for each.

### 4.1 Inventory

- Raw material and finished goods (feed) stock master
- Stock in (from production/purchase) and stock out (to sales/dispatch)
- Real-time stock levels feeding the dealer portal's catalog
- Optional batch/lot tracking with expiry (nice-to-have, not phase-1 critical)
- Low-stock alerts

### 4.2 Production (continuous process manufacturing)

- Record production runs/output for continuous processes (throughput over a shift/day rather than discrete batches)
- Raw material consumption tied to output, feeding stock deduction
- Basic QC checks recorded per run (no formal compliance/traceability certification required)
- Production yield reporting (input vs output)

### 4.3 Admin / Master data

- Product catalog management (categories, SKUs, pricing)
- Dealer master data and credit limit configuration/monitoring
- User and role management
- Sales rep → manager → director hierarchy configuration

## 5. Portal 2 — Sales & Management Portal

Used by Sales Reps, Sales Managers, Sales Director, Logistics/Dispatch, and Finance/Accounts Approvers.

### 5.1 Sales Rep view

- See incoming orders placed by mapped dealers (from the Dealer Portal)
- Ability to also place/edit an order on a dealer's behalf
- Submit order to Sales Manager for credit check & approval
- View order status history for own dealers

### 5.2 Sales Manager view

- Queue of orders pending approval from mapped reps
- Dealer credit exposure shown against dynamic credit limit (based on outstanding invoices/aging)
- Approve, reject, or override (with mandatory remark) an order that exceeds credit limit
- Escalate an override to Sales Director where required
- Dashboard: team performance, pending approvals, credit exposure by dealer

### 5.3 Sales Director view

- Cross-manager dashboard: sales trends, credit exposure, team performance
- Approve orders escalated from managers (overrides)
- No routine order handling — oversight and escalation only

### 5.4 Logistics/Dispatch view

- List of approved orders ready for dispatch
- Update dispatch/delivery status (feeds dealer's order tracking)

### 5.5 Finance/Accounts Approver view

- Manually trigger GST-compliant invoice generation against approved/dispatched orders
- Maintain dealer ledgers: payments received, outstanding dues, partial payments
- Reconcile with Tally

## 6. Portal 3 — Dealer Portal

Single login per dealer account (no multi-user support needed).

- Browse product catalog with **real-time stock availability**
- Place new orders (quantities, requested delivery)
- View own outstanding dues / ledger summary
- Full order status tracking: **Pending → Approved → Dispatched → Invoiced**
- View past order history

## 7. Core Workflow — Order-to-Cash & Credit Approval

1. **Dealer** browses catalog (live stock) on Dealer Portal and places an order
2. Order lands with the dealer's mapped **Sales Rep**
3. Sales Rep forwards/submits the order to their **Sales Manager**
4. System checks the order value against the dealer's **dynamic credit limit** (based on outstanding invoices/aging)
   - **Within limit** → Manager reviews and approves
   - **Exceeds limit** → Manager can override with a mandatory reason/remark, or escalate to **Sales Director** for approval
5. Once approved, order moves to **Logistics/Dispatch** for fulfillment
6. Dispatch updates status to Dispatched; dealer sees this in their order tracking
7. **Finance/Accounts** manually triggers GST-compliant invoice generation
8. Invoice and payment status feed the dealer ledger; data syncs to **Tally**
9. Dealer can track status at every stage: Pending → Approved → Dispatched → Invoiced

## 8. Invoicing & Finance

- Invoice generation is **manually triggered** by Finance/Accounts (not automatic on approval or dispatch)
- Invoices must be **GST-compliant** (correct tax breakup, HSN codes, invoice numbering per Indian GST rules)
- **Dealer ledgers**: track partial payments and outstanding dues per dealer, feeding the dynamic credit-limit check in Section 7
- Invoice and payment data should be structured for clean sync/export to **Tally** (see Section 9)

## 9. Integrations & Non-Functional Requirements

### 9.1 Tally integration

- Sync invoices, payments, and dealer ledger entries to Tally (one-way or two-way, to be finalized in technical design)
- Tally remains the accounting system of record; this ERP is not a replacement

### 9.2 Platform

- Web-based only across all three portals; no native mobile apps in scope
- Responsive web design so the Dealer Portal and Sales Portal are usable on mobile browsers

### 9.3 Hosting & Infrastructure

- Deployed on a **Hostinger VPS**
- Role-based access control across all three portals
- Regular backups of the VPS/database

### 9.4 Reporting & Dashboards

- Sales trends (by dealer, rep, manager, region/period)
- Inventory aging and stock levels
- Production yield (input vs output)
- Credit exposure and outstanding dues by dealer

## 10. Phased Rollout Plan

Full production system, delivered and tracked module-by-module so each phase is completed and stable before the next begins.

### Phase 1 — Core Foundation

- Master data: products, dealers, users, roles, hierarchy (rep → manager → director)
- Inventory module (stock in/out, real-time levels)
- Dealer Portal: catalog with live stock + order placement
- Sales Portal: rep order queue, manager approval with dynamic credit check & override
- Basic order status tracking (Pending → Approved)

### Phase 2 — Production & Fulfillment

- Production module (continuous-process runs, output, raw material consumption, basic QC)
- Logistics/Dispatch module and dispatch status updates
- Full order status tracking through to Dispatched

### Phase 3 — Finance & Invoicing

- GST-compliant invoicing (manually triggered)
- Dealer ledgers: partial payments, outstanding dues
- Tally integration (sync invoices/payments)
- Order status extended to Invoiced

### Phase 4 — Reporting, Analytics & Refinement

- Sales, inventory, production, and credit-exposure dashboards
- Sales Director oversight dashboard
- Optional: batch/lot expiry tracking if still desired
- Performance tuning and UAT-driven refinements

## 11. Assumptions & Open Questions

**Assumptions**

- "Continuous process manufacturing" means output is tracked per shift/day/period rather than per discrete work order
- Tally integration is a data sync (invoices, payments, ledgers), not a full accounting replacement
- No formal FSSAI/compliance certification workflow is required at this stage — QC is basic/internal

**Open questions**

- Exact GST invoice format/numbering scheme QSA currently uses in Tally (to mirror it exactly)
- Direction of Tally sync: one-way (ERP → Tally) or two-way
- Whether raw material procurement/purchase orders are in scope, or purchasing stays outside this ERP
- Specific fields needed on the dealer credit-limit calculation (which invoice ages count, any grace period)
