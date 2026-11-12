import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM mrp_runs ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.run_date) return NextResponse.json({ error: "run_date is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO mrp_runs (id, run_date, horizon_days, status) VALUES (?, ?,?,?)",
    [id, b.run_date ?? null, b.horizon_days ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
