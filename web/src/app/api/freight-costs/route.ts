import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM freight_costs ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO freight_costs (id, order_id, shipment_id, amount, carrier) VALUES (?, ?,?,?,?)",
    [id, b.order_id ?? null, b.shipment_id ?? null, b.amount ?? null, b.carrier ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
