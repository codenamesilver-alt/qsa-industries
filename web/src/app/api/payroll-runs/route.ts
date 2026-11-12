import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM payroll_runs ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.period_name) return NextResponse.json({ error: "period_name is required" }, { status: 400 });
  if (!b.run_date) return NextResponse.json({ error: "run_date is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO payroll_runs (id, period_name, run_date, total_amount, status) VALUES (?, ?,?,?,?)",
    [id, b.period_name ?? null, b.run_date ?? null, b.total_amount ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
