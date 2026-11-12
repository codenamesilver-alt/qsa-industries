import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM lead_activities ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.lead_id) return NextResponse.json({ error: "lead_id is required" }, { status: 400 });
  if (!b.activity_type) return NextResponse.json({ error: "activity_type is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO lead_activities (id, lead_id, activity_type, notes, due_date, status) VALUES (?, ?,?,?,?,?)",
    [id, b.lead_id ?? null, b.activity_type ?? null, b.notes ?? null, b.due_date ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
