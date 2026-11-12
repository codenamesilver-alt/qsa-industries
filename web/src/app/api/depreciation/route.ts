import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM depreciation ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.asset_id) return NextResponse.json({ error: "asset_id is required" }, { status: 400 });
  if (!b.period) return NextResponse.json({ error: "period is required" }, { status: 400 });
  if (!b.amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO depreciation (id, asset_id, period, amount, method) VALUES (?, ?,?,?,?)",
    [id, b.asset_id ?? null, b.period ?? null, b.amount ?? null, b.method ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
