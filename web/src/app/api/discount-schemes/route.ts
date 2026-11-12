import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM discount_schemes ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!b.discount_value) return NextResponse.json({ error: "discount_value is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO discount_schemes (id, name, description, discount_type, discount_value, min_qty, product_id, dealer_id, valid_from, valid_to, is_active) VALUES (?, ?,?,?,?,?,?,?,?,?,?)",
    [id, b.name ?? null, b.description ?? null, b.discount_type ?? null, b.discount_value ?? null, b.min_qty ?? null, b.product_id ?? null, b.dealer_id ?? null, b.valid_from ?? null, b.valid_to ?? null, b.is_active ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
