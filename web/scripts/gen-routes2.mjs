import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const entities = [
  { name: "suppliers", table: "suppliers", cols: ["name", "contact_person", "phone", "email", "gstin", "address", "payment_terms", "lead_time_days", "rating", "is_active"], required: ["name"] },
  { name: "product-variants", table: "product_variants", cols: ["product_id", "variant_name", "sku", "attributes", "price", "is_active"], required: ["product_id", "variant_name"] },
  { name: "product-uom", table: "product_uom", cols: ["product_id", "uom", "conversion_factor", "is_base"], required: ["product_id", "uom"] },
  { name: "product-barcodes", table: "product_barcodes", cols: ["product_id", "barcode", "barcode_type"], required: ["product_id", "barcode"] },
  { name: "tax-groups", table: "tax_groups", cols: ["name", "rate", "hsn_code", "is_active"], required: ["name", "rate"] },
  { name: "product-images", table: "product_images", cols: ["product_id", "file_path", "is_primary"], required: ["product_id", "file_path"] },
  { name: "category-hierarchy", table: "category_hierarchy", cols: ["name", "parent_id", "sort_order"], required: ["name"] },
  { name: "serial-numbers", table: "serial_numbers", cols: ["product_id", "serial", "batch_id", "status", "warehouse_id"], required: ["product_id", "serial"] },
  { name: "stock-reservations", table: "stock_reservations", cols: ["product_id", "warehouse_id", "quantity", "order_id", "status"], required: ["product_id", "quantity"] },
  { name: "stock-transfers", table: "stock_transfers", cols: ["from_warehouse_id", "to_warehouse_id", "product_id", "quantity", "status"], required: ["from_warehouse_id", "to_warehouse_id", "product_id", "quantity"] },
  { name: "quarantine-stock", table: "quarantine_stock", cols: ["product_id", "batch_id", "quantity", "reason", "status"], required: ["product_id", "quantity"] },
  { name: "cycle-counts", table: "cycle_counts", cols: ["warehouse_id", "count_date", "status"], required: ["count_date"] },
  { name: "uom-conversions", table: "uom_conversions", cols: ["from_uom", "to_uom", "factor"], required: ["from_uom", "to_uom", "factor"] },
  { name: "safety-stock", table: "safety_stock", cols: ["product_id", "warehouse_id", "min_qty", "max_qty", "reorder_point"], required: ["product_id", "min_qty"] },
  { name: "work-centers", table: "work_centers", cols: ["code", "name", "capacity_per_day", "cost_per_hour", "is_active"], required: ["code", "name"] },
  { name: "routings", table: "routings", cols: ["product_id", "work_center_id", "operation", "sequence_no", "duration_minutes"], required: ["product_id", "operation"] },
  { name: "work-orders", table: "work_orders", cols: ["wo_number", "product_id", "quantity", "status", "start_date", "due_date", "work_center_id"], required: ["wo_number", "product_id", "quantity"] },
  { name: "wip-tracking", table: "wip_tracking", cols: ["work_order_id", "stage", "quantity"], required: ["work_order_id", "stage", "quantity"] },
  { name: "scrap-records", table: "scrap_records", cols: ["production_run_id", "product_id", "quantity", "reason"], required: ["quantity"] },
  { name: "bom-versions", table: "bom_versions", cols: ["finished_product_id", "version", "effective_from", "effective_to", "is_active"], required: ["finished_product_id", "version"] },
  { name: "quality-inspections", table: "quality_inspections", cols: ["inspection_type", "reference_type", "reference_id", "product_id", "batch_id", "result", "inspector_id", "inspected_at", "notes"], required: ["inspection_type"] },
  { name: "sampling-plans", table: "sampling_plans", cols: ["product_id", "plan_name", "sample_size", "frequency", "is_active"], required: ["product_id", "plan_name", "sample_size"] },
  { name: "coa", table: "coa", cols: ["production_run_id", "batch_id", "coa_number", "issued_at", "issued_by", "file_path"], required: ["coa_number"] },
  { name: "ncr", table: "ncr", cols: ["ncr_number", "description", "severity", "status"], required: ["ncr_number", "description"] },
  { name: "capa", table: "capa", cols: ["capa_number", "ncr_id", "root_cause", "corrective_action", "preventive_action", "status", "owner_id", "due_date"], required: ["capa_number"] },
  { name: "deviations", table: "deviations", cols: ["deviation_number", "description", "severity", "status"], required: ["deviation_number", "description"] },
  { name: "calibration-records", table: "calibration_records", cols: ["equipment_id", "calibration_date", "next_due", "result", "performed_by", "notes"], required: ["calibration_date"] },
  { name: "test-methods", table: "test_methods", cols: ["name", "description", "standard_ref", "is_active"], required: ["name"] },
  { name: "mrp-runs", table: "mrp_runs", cols: ["run_date", "horizon_days", "status"], required: ["run_date"] },
  { name: "purchase-requisitions", table: "purchase_requisitions", cols: ["pr_number", "requested_by", "department", "status", "notes"], required: ["pr_number"] },
  { name: "rfq", table: "rfq", cols: ["rfq_number", "title", "status"], required: ["rfq_number", "title"] },
  { name: "grn", table: "grn", cols: ["grn_number", "po_id", "received_date", "status"], required: ["grn_number", "received_date"] },
  { name: "three-way-match", table: "three_way_match", cols: ["po_id", "grn_id", "invoice_id", "match_status", "notes"], required: [] },
  { name: "ap-payments", table: "ap_payments", cols: ["supplier_id", "purchase_invoice_id", "amount", "payment_date", "mode", "reference"], required: ["amount", "payment_date"] },
  { name: "landed-costs", table: "landed_costs", cols: ["po_id", "cost_type", "amount", "allocation_method"], required: ["cost_type", "amount"] },
  { name: "blanket-pos", table: "blanket_pos", cols: ["po_number", "supplier_id", "total_qty", "released_qty", "valid_from", "valid_to", "status"], required: ["po_number"] },
  { name: "supplier-returns", table: "supplier_returns", cols: ["return_number", "supplier_id", "po_id", "reason", "amount", "status"], required: ["return_number"] },
  { name: "gl-accounts", table: "gl_accounts", cols: ["code", "name", "account_type", "parent_id", "is_active"], required: ["code", "name", "account_type"] },
  { name: "journal-entries", table: "journal_entries", cols: ["entry_number", "entry_date", "description", "status"], required: ["entry_number", "entry_date"] },
  { name: "payment-terms", table: "payment_terms", cols: ["name", "days", "description"], required: ["name"] },
  { name: "dunning", table: "dunning", cols: ["dealer_id", "invoice_id", "level", "status"], required: ["dealer_id"] },
  { name: "write-offs", table: "write_offs", cols: ["invoice_id", "dealer_id", "amount", "reason"], required: ["amount"] },
  { name: "currencies", table: "currencies", cols: ["code", "name", "symbol", "is_base"], required: ["code", "name"] },
  { name: "exchange-rates", table: "exchange_rates", cols: ["from_currency", "to_currency", "rate", "rate_date"], required: ["from_currency", "to_currency", "rate", "rate_date"] },
  { name: "budgets", table: "budgets", cols: ["budget_name", "period", "amount", "department"], required: ["budget_name", "period", "amount"] },
  { name: "cost-centers", table: "cost_centers", cols: ["code", "name", "parent_id", "is_active"], required: ["code", "name"] },
  { name: "depreciation", table: "depreciation", cols: ["asset_id", "period", "amount", "method"], required: ["asset_id", "period", "amount"] },
  { name: "cheque-management", table: "cheque_management", cols: ["cheque_number", "bank_account_id", "payee", "amount", "status", "issue_date", "clearance_date"], required: ["cheque_number", "amount"] },
  { name: "expense-approvals", table: "expense_approvals", cols: ["expense_id", "approver_id", "status", "notes"], required: ["expense_id"] },
  { name: "tally-config", table: "tally_config", cols: ["voucher_type", "gst_split_mode", "voucher_numbering", "xml_format", "period_convention"], required: [] },
  { name: "invoice-cancellations", table: "invoice_cancellations", cols: ["invoice_id", "reason", "cancelled_by"], required: ["invoice_id", "reason"] },
  { name: "refunds", table: "refunds", cols: ["payment_id", "dealer_id", "amount", "reason", "status"], required: ["amount"] },
  { name: "shifts", table: "shifts", cols: ["name", "start_time", "end_time", "is_active"], required: ["name", "start_time", "end_time"] },
  { name: "holiday-calendar", table: "holiday_calendar", cols: ["holiday_date", "name", "is_optional"], required: ["holiday_date", "name"] },
  { name: "leave-types", table: "leave_types", cols: ["name", "description", "default_quota", "carry_forward", "is_active"], required: ["name"] },
  { name: "leave-balances", table: "leave_balances", cols: ["employee_id", "leave_type_id", "year", "balance", "used"], required: ["employee_id", "leave_type_id", "year"] },
  { name: "payroll-components", table: "payroll_components", cols: ["name", "component_type", "is_taxable", "is_active"], required: ["name", "component_type"] },
  { name: "salary-structures", table: "salary_structures", cols: ["employee_id", "component_id", "amount"], required: ["employee_id", "component_id", "amount"] },
  { name: "tax-declarations", table: "tax_declarations", cols: ["employee_id", "financial_year", "declaration_type", "amount", "status"], required: ["employee_id", "financial_year", "declaration_type"] },
  { name: "recruitment", table: "recruitment", cols: ["candidate_name", "email", "phone", "position", "status"], required: ["candidate_name"] },
  { name: "training", table: "training", cols: ["employee_id", "training_name", "start_date", "end_date", "status"], required: ["employee_id", "training_name"] },
  { name: "exit-records", table: "exit_records", cols: ["employee_id", "resignation_date", "last_working_day", "reason", "status"], required: ["employee_id"] },
  { name: "shipments", table: "shipments", cols: ["shipment_number", "order_id", "carrier", "tracking_number", "status"], required: ["shipment_number"] },
  { name: "pick-pack", table: "pick_pack", cols: ["order_id", "status", "packed_by", "packed_at"], required: ["order_id"] },
  { name: "vehicles", table: "vehicles", cols: ["code", "vehicle_number", "driver_name", "capacity", "status"], required: ["code", "vehicle_number"] },
  { name: "route-plans", table: "route_plans", cols: ["name", "beat", "sales_rep_id"], required: ["name"] },
  { name: "freight-costs", table: "freight_costs", cols: ["order_id", "shipment_id", "amount", "carrier"], required: ["amount"] },
  { name: "returns", table: "returns", cols: ["return_number", "order_id", "dealer_id", "reason", "status"], required: ["return_number"] },
  { name: "campaigns", table: "campaigns", cols: ["name", "description", "start_date", "end_date", "budget", "status"], required: ["name"] },
  { name: "lead-activities", table: "lead_activities", cols: ["lead_id", "activity_type", "notes", "due_date", "status"], required: ["lead_id", "activity_type"] },
  { name: "global-search-index", table: "global_search_index", cols: ["entity_type", "entity_id", "title", "body"], required: ["entity_type", "entity_id", "title"] },
  { name: "document-folders", table: "document_folders", cols: ["name", "parent_id"], required: ["name"] },
  { name: "documents", table: "documents", cols: ["folder_id", "name", "file_path", "mime_type", "size_bytes", "version", "uploaded_by"], required: ["name", "file_path"] },
  { name: "notification-channels", table: "notification_channels", cols: ["user_id", "channel", "address", "is_active"], required: ["channel", "address"] },
  { name: "notification-templates", table: "notification_templates", cols: ["code", "subject", "body"], required: ["code", "body"] },
  { name: "workflows", table: "workflows", cols: ["name", "entity_type", "definition", "is_active"], required: ["name", "entity_type", "definition"] },
  { name: "sessions", table: "sessions", cols: ["user_id", "token_hash", "expires_at"], required: ["user_id", "token_hash", "expires_at"] },
  { name: "password-resets", table: "password_resets", cols: ["user_id", "token", "expires_at", "used"], required: ["user_id", "token", "expires_at"] },
  { name: "user-preferences", table: "user_preferences", cols: ["user_id", "pref_key", "pref_value"], required: ["user_id", "pref_key"] },
  { name: "audit-diff", table: "audit_diff", cols: ["audit_log_id", "field_name", "old_value", "new_value"], required: ["audit_log_id", "field_name"] },
  { name: "scheduled-reports", table: "scheduled_reports", cols: ["report_name", "schedule", "recipients", "is_active"], required: ["report_name", "schedule"] },
  { name: "kpi-snapshots", table: "kpi_snapshots", cols: ["kpi_name", "kpi_value", "snapshot_date"], required: ["kpi_name", "snapshot_date"] },
];

const base = join(process.cwd(), "src", "app", "api");

for (const e of entities) {
  const dir = join(base, e.name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cols = e.cols.join(", ");
  const placeholders = e.cols.map(() => "?").join(",");
  const reqChecks = e.required.map((r) => `  if (!b.${r}) return NextResponse.json({ error: "${r} is required" }, { status: 400 });`).join("\n");
  const code = `import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM ${e.table} ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
${reqChecks}
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO ${e.table} (id, ${cols}) VALUES (?, ${placeholders})",
    [id, ${e.cols.map((c) => `b.${c} ?? null`).join(", ")}],
  );
  return NextResponse.json({ data: { id }, error: null });
}
`;
  writeFileSync(join(dir, "route.ts"), code, "utf8");
  console.log("created", e.name);
}
console.log("DONE");
