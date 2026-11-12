import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM holiday_calendar ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.holiday_date) return NextResponse.json({ error: "holiday_date is required" }, { status: 400 });
  if (!b.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO holiday_calendar (id, holiday_date, name, is_optional) VALUES (?, ?,?,?)",
    [id, b.holiday_date ?? null, b.name ?? null, b.is_optional ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
