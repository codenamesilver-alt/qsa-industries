import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM shipments ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.shipment_number) return NextResponse.json({ error: "shipment_number is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO shipments (id, shipment_number, order_id, carrier, tracking_number, status) VALUES (?, ?,?,?,?,?)",
    [id, b.shipment_number ?? null, b.order_id ?? null, b.carrier ?? null, b.tracking_number ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
