import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM routings ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.product_id) return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  if (!b.operation) return NextResponse.json({ error: "operation is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO routings (id, product_id, work_center_id, operation, sequence_no, duration_minutes) VALUES (?, ?,?,?,?,?)",
    [id, b.product_id ?? null, b.work_center_id ?? null, b.operation ?? null, b.sequence_no ?? null, b.duration_minutes ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
