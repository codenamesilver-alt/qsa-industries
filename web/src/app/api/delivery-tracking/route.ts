import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM delivery_tracking ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.order_id) return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO delivery_tracking (id, order_id, carrier, tracking_number, status, notes) VALUES (?, ?,?,?,?,?)",
    [id, b.order_id ?? null, b.carrier ?? null, b.tracking_number ?? null, b.status ?? null, b.notes ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
