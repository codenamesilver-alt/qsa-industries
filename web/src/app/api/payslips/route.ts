import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const runId = url.searchParams.get("run_id");
  const sql = runId ? "SELECT * FROM payslips WHERE payroll_run_id=? ORDER BY employee_name" : "SELECT * FROM payslips ORDER BY generated_at DESC";
  const rows = await query<any>(sql, runId ? [runId] : []);
  return NextResponse.json({ data: rows, error: null });
}
