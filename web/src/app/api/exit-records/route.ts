import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM exit_records ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.employee_id) return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO exit_records (id, employee_id, resignation_date, last_working_day, reason, status) VALUES (?, ?,?,?,?,?)",
    [id, b.employee_id ?? null, b.resignation_date ?? null, b.last_working_day ?? null, b.reason ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
