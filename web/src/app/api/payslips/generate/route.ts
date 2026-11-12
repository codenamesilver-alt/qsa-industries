import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ["admin", "finance"] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await request.json();
  const run = await queryOne<any>("SELECT * FROM payroll_runs WHERE id=?", [b.payroll_run_id]);
  if (!run) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
  // remove existing slips for this run
  await query("DELETE FROM payslips WHERE payroll_run_id=?", [b.payroll_run_id]);
  const lines = await query<any>("SELECT pl.*, e.full_name, e.salary FROM payroll_lines pl LEFT JOIN employees e ON e.id=pl.employee_id WHERE pl.payroll_run_id=?", [b.payroll_run_id]);
  let total = 0;
  for (const l of lines) {
    const id = crypto.randomUUID();
    const gross = Number(l.gross ?? l.salary ?? 0);
    const ded = Number(l.deductions ?? 0);
    const net = Number(l.net ?? (gross - ded));
    total += net;
    await query(
      "INSERT INTO payslips (id, payroll_run_id, employee_id, employee_name, period_name, gross, deductions, net, earnings_detail, deductions_detail) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [id, b.payroll_run_id, l.employee_id, l.full_name ?? "Employee", run.period_name, gross, ded, net, "Basic salary", ded > 0 ? "Deductions" : null],
    );
  }
  await query("UPDATE payroll_runs SET total_amount=?, status='processed' WHERE id=?", [total.toFixed(2), b.payroll_run_id]);
  return NextResponse.json({ data: { count: lines.length }, error: null });
}
