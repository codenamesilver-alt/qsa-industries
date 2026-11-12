import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM leave_balances ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.employee_id) return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
  if (!b.leave_type_id) return NextResponse.json({ error: "leave_type_id is required" }, { status: 400 });
  if (!b.year) return NextResponse.json({ error: "year is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO leave_balances (id, employee_id, leave_type_id, year, balance, used) VALUES (?, ?,?,?,?,?)",
    [id, b.employee_id ?? null, b.leave_type_id ?? null, b.year ?? null, b.balance ?? null, b.used ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
