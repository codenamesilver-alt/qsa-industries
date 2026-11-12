import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM training ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.employee_id) return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
  if (!b.training_name) return NextResponse.json({ error: "training_name is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO training (id, employee_id, training_name, start_date, end_date, status) VALUES (?, ?,?,?,?,?)",
    [id, b.employee_id ?? null, b.training_name ?? null, b.start_date ?? null, b.end_date ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
