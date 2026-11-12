import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','finance'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  const inv = await queryOne<any>("SELECT dealer_id FROM invoices WHERE id=?", [b.target_invoice_id]);
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO payments (id,invoice_id,dealer_id,amount,payment_date,mode,reference) VALUES (?,?,?,?,?,?,?)",
    [id, b.target_invoice_id, inv?.dealer_id, b.payment_amount, b.payment_date_value, b.payment_mode_value, b.payment_reference],
  );
  return NextResponse.json({ data: null, error: null });
}