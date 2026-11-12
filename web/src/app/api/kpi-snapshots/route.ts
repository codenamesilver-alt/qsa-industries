import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM kpi_snapshots ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.kpi_name) return NextResponse.json({ error: "kpi_name is required" }, { status: 400 });
  if (!b.snapshot_date) return NextResponse.json({ error: "snapshot_date is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO kpi_snapshots (id, kpi_name, kpi_value, snapshot_date) VALUES (?, ?,?,?)",
    [id, b.kpi_name ?? null, b.kpi_value ?? null, b.snapshot_date ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
