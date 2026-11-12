import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM blanket_pos ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.po_number) return NextResponse.json({ error: "po_number is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO blanket_pos (id, po_number, supplier_id, total_qty, released_qty, valid_from, valid_to, status) VALUES (?, ?,?,?,?,?,?,?)",
    [id, b.po_number ?? null, b.supplier_id ?? null, b.total_qty ?? null, b.released_qty ?? null, b.valid_from ?? null, b.valid_to ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
