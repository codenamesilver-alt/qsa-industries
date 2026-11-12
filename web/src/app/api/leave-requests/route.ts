import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM leave_requests ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.employee_id) return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
  if (!b.leave_type) return NextResponse.json({ error: "leave_type is required" }, { status: 400 });
  if (!b.start_date) return NextResponse.json({ error: "start_date is required" }, { status: 400 });
  if (!b.end_date) return NextResponse.json({ error: "end_date is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO leave_requests (id, employee_id, leave_type, start_date, end_date, reason, status) VALUES (?, ?,?,?,?,?,?)",
    [id, b.employee_id ?? null, b.leave_type ?? null, b.start_date ?? null, b.end_date ?? null, b.reason ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
