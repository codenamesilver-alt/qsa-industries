import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM salary_structures ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.employee_id) return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
  if (!b.component_id) return NextResponse.json({ error: "component_id is required" }, { status: 400 });
  if (!b.amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO salary_structures (id, employee_id, component_id, amount) VALUES (?, ?,?,?)",
    [id, b.employee_id ?? null, b.component_id ?? null, b.amount ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
