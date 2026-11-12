import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM credit_notes ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.note_number) return NextResponse.json({ error: "note_number is required" }, { status: 400 });
  if (!b.dealer_id) return NextResponse.json({ error: "dealer_id is required" }, { status: 400 });
  if (!b.amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
  if (!b.total_amount) return NextResponse.json({ error: "total_amount is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO credit_notes (id, note_number, dealer_id, invoice_id, note_type, reason, amount, gst_amount, total_amount) VALUES (?, ?,?,?,?,?,?,?,?)",
    [id, b.note_number ?? null, b.dealer_id ?? null, b.invoice_id ?? null, b.note_type ?? null, b.reason ?? null, b.amount ?? null, b.gst_amount ?? null, b.total_amount ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
