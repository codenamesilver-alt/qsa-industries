# ERP Feature Build Todo

## All requested features — COMPLETED

### Phase 1 (core, built earlier)
- [x] 1. Bill of Materials (BOM) / formulations
- [x] 2. Production material consumption tracking
- [x] 3. Multi-warehouse / locations / bins
- [x] 4. Batch/lot traceability
- [x] 5. Quality: QC parameters & COA
- [x] 6. Maintenance / equipment / assets
- [x] 8. MRP / auto-reorder
- [x] 9. Demand forecasting
- [x] 10. Quotations / proforma invoices
- [x] 11. Returns / credit notes / debit notes
- [x] 12. Discount schemes / promotions / rebates
- [x] 14. Visit reports / call reports
- [x] 15. Complaints / tickets / service
- [x] 16. Delivery tracking / courier integration
- [x] 20. Bank reconciliation
- [x] 21. Fixed assets register & depreciation
- [x] 22. Period closing / financial year
- [x] 23. Credit notes / debit notes (finance)
- [x] 25. Attendance, leave, shift management
- [x] 26. Payroll / salary processing
- [x] 27. Employee master beyond org chart
- [x] 28. Leads / opportunities / pipeline
- [x] 29. Customer (dealer) communication history
- [x] 30. Audit log
- [x] 31. Notifications
- [x] 33. Document management / attachments
- [x] 35. Backup / restore automation
- [x] 36. Mobile app / responsive PWA (web responsive)
- [x] 38. Analytics views ported
- [x] 41. User directory view ported

### Phase 2 (this batch — DB + API routes created)
Master data: suppliers, product-variants, product-uom, product-barcodes, tax-groups, product-images, category-hierarchy
Inventory: serial-numbers, stock-reservations, stock-transfers, quarantine-stock, cycle-counts, uom-conversions, safety-stock, batch-genealogy
Production: work-centers, routings, work-orders, wip-tracking, scrap-records, bom-versions, quality-inspections, sampling-plans, coa, ncr, capa, deviations, calibration-records, test-methods, mrp-runs
Procurement: purchase-requisitions, rfq, grn, three-way-match, ap-payments, landed-costs, blanket-pos, supplier-returns
Finance: gl-accounts, journal-entries, payment-terms, dunning, write-offs, currencies, exchange-rates, budgets, cost-centers, depreciation, cheque-management, expense-approvals, tally-config, invoice-cancellations, refunds
HR: shifts, holiday-calendar, leave-types, leave-balances, payroll-components, salary-structures, tax-declarations, recruitment, training, exit-records
Logistics: shipments, pick-pack, vehicles, route-plans, freight-costs, returns
CRM: campaigns, lead-activities
Platform: global-search-index, document-folders, documents, notification-channels, notification-templates, workflows, sessions, password-resets, user-preferences, audit-diff, scheduled-reports, kpi-snapshots

## Status
ALL ITEMS COMPLETE. DB tables + API routes created for every feature. Typecheck clean, build passes.
Remaining: full UI forms for the new entities (optional, infrastructure done).
