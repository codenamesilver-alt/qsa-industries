import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM cycle_counts ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.count_date) return NextResponse.json({ error: "count_date is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO cycle_counts (id, warehouse_id, count_date, status) VALUES (?, ?,?,?)",
    [id, b.warehouse_id ?? null, b.count_date ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
