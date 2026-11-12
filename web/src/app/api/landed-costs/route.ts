import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM landed_costs ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.cost_type) return NextResponse.json({ error: "cost_type is required" }, { status: 400 });
  if (!b.amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO landed_costs (id, po_id, cost_type, amount, allocation_method) VALUES (?, ?,?,?,?)",
    [id, b.po_id ?? null, b.cost_type ?? null, b.amount ?? null, b.allocation_method ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
