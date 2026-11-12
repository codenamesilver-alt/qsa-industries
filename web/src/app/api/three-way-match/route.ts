import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM three_way_match ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();

  const id = crypto.randomUUID();
  await query(
    "INSERT INTO three_way_match (id, po_id, grn_id, invoice_id, match_status, notes) VALUES (?, ?,?,?,?,?)",
    [id, b.po_id ?? null, b.grn_id ?? null, b.invoice_id ?? null, b.match_status ?? null, b.notes ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
