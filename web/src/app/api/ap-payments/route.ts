import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM ap_payments ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
  if (!b.payment_date) return NextResponse.json({ error: "payment_date is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO ap_payments (id, supplier_id, purchase_invoice_id, amount, payment_date, mode, reference) VALUES (?, ?,?,?,?,?,?)",
    [id, b.supplier_id ?? null, b.purchase_invoice_id ?? null, b.amount ?? null, b.payment_date ?? null, b.mode ?? null, b.reference ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
