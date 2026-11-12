import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const entities = [
  { name: "reorder-rules", table: "reorder_rules", cols: ["product_id", "min_qty", "reorder_qty", "preferred_supplier", "is_active"], required: ["product_id", "min_qty", "reorder_qty"] },
  { name: "quotations", table: "quotations", cols: ["quote_number", "dealer_id", "status", "valid_until", "total_amount", "notes"], required: ["quote_number", "dealer_id"] },
  { name: "credit-notes", table: "credit_notes", cols: ["note_number", "dealer_id", "invoice_id", "note_type", "reason", "amount", "gst_amount", "total_amount"], required: ["note_number", "dealer_id", "amount", "total_amount"] },
  { name: "discount-schemes", table: "discount_schemes", cols: ["name", "description", "discount_type", "discount_value", "min_qty", "product_id", "dealer_id", "valid_from", "valid_to", "is_active"], required: ["name", "discount_value"] },
  { name: "visit-reports", table: "visit_reports", cols: ["sales_rep_id", "dealer_id", "visit_date", "purpose", "notes", "outcome"], required: ["sales_rep_id", "visit_date"] },
  { name: "tickets", table: "tickets", cols: ["ticket_number", "subject", "description", "dealer_id", "raised_by", "assigned_to", "priority", "status"], required: ["ticket_number", "subject"] },
  { name: "bank-statements", table: "bank_statements", cols: ["statement_date", "description", "reference", "amount", "status"], required: ["statement_date", "amount"] },
  { name: "financial-periods", table: "financial_periods", cols: ["period_name", "start_date", "end_date", "is_closed"], required: ["period_name", "start_date", "end_date"] },
  { name: "employees", table: "employees", cols: ["user_id", "full_name", "department", "designation", "join_date", "salary", "status"], required: ["full_name"] },
  { name: "attendance", table: "attendance", cols: ["employee_id", "att_date", "status", "check_in", "check_out", "notes"], required: ["employee_id", "att_date"] },
  { name: "leave-requests", table: "leave_requests", cols: ["employee_id", "leave_type", "start_date", "end_date", "reason", "status"], required: ["employee_id", "leave_type", "start_date", "end_date"] },
  { name: "payroll-runs", table: "payroll_runs", cols: ["period_name", "run_date", "total_amount", "status"], required: ["period_name", "run_date"] },
  { name: "leads", table: "leads", cols: ["name", "company", "email", "phone", "source", "status", "owner_id", "notes"], required: ["name"] },
  { name: "opportunities", table: "opportunities", cols: ["lead_id", "dealer_id", "title", "stage", "value", "probability", "expected_close", "owner_id"], required: ["title"] },
  { name: "communications", table: "communications", cols: ["dealer_id", "user_id", "comm_type", "subject", "notes", "comm_date"], required: ["comm_type"] },
  { name: "notifications", table: "notifications", cols: ["user_id", "title", "body", "link", "is_read"], required: ["title"] },
  { name: "demand-forecasts", table: "demand_forecasts", cols: ["product_id", "period", "forecast_qty", "actual_qty"], required: ["product_id", "period", "forecast_qty"] },
  { name: "delivery-tracking", table: "delivery_tracking", cols: ["order_id", "carrier", "tracking_number", "status", "notes"], required: ["order_id"] },
  { name: "bank-accounts", table: "bank_accounts", cols: ["name", "account_number", "bank_name", "balance", "is_active"], required: ["name"] },
  { name: "backup-log", table: "backup_log", cols: ["backup_type", "file_path", "size_bytes", "status"], required: ["backup_type"] },
];

for (const e of entities) {
  const dir = join(process.cwd(), "src", "app", "api", e.name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const cols = e.cols.map((c) => c).join(", ");
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
