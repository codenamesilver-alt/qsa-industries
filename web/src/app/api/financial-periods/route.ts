import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM financial_periods ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.period_name) return NextResponse.json({ error: "period_name is required" }, { status: 400 });
  if (!b.start_date) return NextResponse.json({ error: "start_date is required" }, { status: 400 });
  if (!b.end_date) return NextResponse.json({ error: "end_date is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO financial_periods (id, period_name, start_date, end_date, is_closed) VALUES (?, ?,?,?,?)",
    [id, b.period_name ?? null, b.start_date ?? null, b.end_date ?? null, b.is_closed ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
