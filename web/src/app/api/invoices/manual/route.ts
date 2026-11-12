import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','finance'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();

  const dealer = await queryOne<any>("SELECT * FROM dealers WHERE id=?", [b.dealer_id]);
  if (!dealer) return NextResponse.json({ error: "Dealer not found" }, { status: 404 });

  const taxable = Number(b.taxable_amount);
  const gst = Number(b.gst_amount);
  const total = Number(b.total_amount);
  if (!Number.isFinite(taxable) || taxable < 0) return NextResponse.json({ error: "Invalid taxable amount" }, { status: 400 });
  if (!Number.isFinite(gst) || gst < 0) return NextResponse.json({ error: "Invalid GST amount" }, { status: 400 });
  if (!Number.isFinite(total) || total < 0) return NextResponse.json({ error: "Invalid total amount" }, { status: 400 });

  const id = crypto.randomUUID();
  const invNum = b.invoice_number?.trim() || `INV-MANUAL-${Date.now()}`;
  await query(
    "INSERT INTO invoices (id,order_id,dealer_id,invoice_number,taxable_amount,gst_amount,total_amount,invoice_date) VALUES (?,?,?,?,?,?,?,?)",
    [id, null, dealer.id, invNum, taxable, gst, total, b.invoice_date || new Date().toISOString().slice(0, 10)],
  );

  return NextResponse.json({ data: { id, invoice_number: invNum }, error: null });
}
