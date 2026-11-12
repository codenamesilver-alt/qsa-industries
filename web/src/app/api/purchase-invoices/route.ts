import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ["admin", "inventory_manager", "production_manager", "finance"] as any))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await request.json();
  if (!b.supplier_name || !String(b.supplier_name).trim()) return NextResponse.json({ error: "Supplier name is required" }, { status: 400 });
  if (!b.invoice_number || !String(b.invoice_number).trim()) return NextResponse.json({ error: "Invoice number is required" }, { status: 400 });
  const taxable = Number(b.taxable_amount);
  const gst = Number(b.gst_amount);
  const total = Number(b.total_amount);
  if (!Number.isFinite(taxable) || taxable < 0) return NextResponse.json({ error: "Invalid taxable amount" }, { status: 400 });
  if (!Number.isFinite(gst) || gst < 0) return NextResponse.json({ error: "Invalid GST amount" }, { status: 400 });
  if (!Number.isFinite(total) || total < 0) return NextResponse.json({ error: "Invalid total amount" }, { status: 400 });
  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length === 0) return NextResponse.json({ error: "At least one line required" }, { status: 400 });

  const id = crypto.randomUUID();
  await query(
    `INSERT INTO purchase_invoices (id, po_id, supplier_name, invoice_number, invoice_date, taxable_amount, gst_amount, total_amount, payment_status, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,'unpaid',?,?)`,
    [id, b.po_id || null, String(b.supplier_name).trim(), String(b.invoice_number).trim(), b.invoice_date || new Date().toISOString().slice(0, 10), taxable, gst, total, b.notes || null, profile.id],
  );
  for (const l of lines) {
    await query(
      "INSERT INTO purchase_invoice_lines (id, purchase_invoice_id, product_id, quantity, unit_price, line_total) VALUES (?,?,?,?,?,?)",
      [crypto.randomUUID(), id, l.product_id, Number(l.quantity), Number(l.unit_price), (Number(l.quantity) * Number(l.unit_price)).toFixed(2)],
    );
  }
  return NextResponse.json({ data: { id }, error: null });
}

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM purchase_invoices ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}
