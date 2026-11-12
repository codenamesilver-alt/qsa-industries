import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM quality_inspections ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.inspection_type) return NextResponse.json({ error: "inspection_type is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO quality_inspections (id, inspection_type, reference_type, reference_id, product_id, batch_id, result, inspector_id, inspected_at, notes) VALUES (?, ?,?,?,?,?,?,?,?,?)",
    [id, b.inspection_type ?? null, b.reference_type ?? null, b.reference_id ?? null, b.product_id ?? null, b.batch_id ?? null, b.result ?? null, b.inspector_id ?? null, b.inspected_at ?? null, b.notes ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
