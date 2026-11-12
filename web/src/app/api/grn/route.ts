import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM grn ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.grn_number) return NextResponse.json({ error: "grn_number is required" }, { status: 400 });
  if (!b.received_date) return NextResponse.json({ error: "received_date is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO grn (id, grn_number, po_id, received_date, status) VALUES (?, ?,?,?,?)",
    [id, b.grn_number ?? null, b.po_id ?? null, b.received_date ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
