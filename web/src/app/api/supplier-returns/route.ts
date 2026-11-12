import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM supplier_returns ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.return_number) return NextResponse.json({ error: "return_number is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO supplier_returns (id, return_number, supplier_id, po_id, reason, amount, status) VALUES (?, ?,?,?,?,?,?)",
    [id, b.return_number ?? null, b.supplier_id ?? null, b.po_id ?? null, b.reason ?? null, b.amount ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
