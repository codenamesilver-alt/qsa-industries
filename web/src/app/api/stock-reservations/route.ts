import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM stock_reservations ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.product_id) return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  if (!b.quantity) return NextResponse.json({ error: "quantity is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO stock_reservations (id, product_id, warehouse_id, quantity, order_id, status) VALUES (?, ?,?,?,?,?)",
    [id, b.product_id ?? null, b.warehouse_id ?? null, b.quantity ?? null, b.order_id ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
