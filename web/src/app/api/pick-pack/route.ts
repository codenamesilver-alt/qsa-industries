import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM pick_pack ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.order_id) return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO pick_pack (id, order_id, status, packed_by, packed_at) VALUES (?, ?,?,?,?)",
    [id, b.order_id ?? null, b.status ?? null, b.packed_by ?? null, b.packed_at ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
