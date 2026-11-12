import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM reorder_rules ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.product_id) return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  if (!b.min_qty) return NextResponse.json({ error: "min_qty is required" }, { status: 400 });
  if (!b.reorder_qty) return NextResponse.json({ error: "reorder_qty is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO reorder_rules (id, product_id, min_qty, reorder_qty, preferred_supplier, is_active) VALUES (?, ?,?,?,?,?)",
    [id, b.product_id ?? null, b.min_qty ?? null, b.reorder_qty ?? null, b.preferred_supplier ?? null, b.is_active ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
