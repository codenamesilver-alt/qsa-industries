import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";
import { auditLog } from "@/lib/audit";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','finance'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  const order = await queryOne<any>("SELECT * FROM orders WHERE id=?", [b.target_order_id]);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const items = await query<any>("SELECT * FROM order_items WHERE order_id=?", [b.target_order_id]);
  const taxable = Number(order.total_amount);
  const gst = Math.round(taxable * 0.05 * 100) / 100;
  const total = taxable + gst;
  const id = crypto.randomUUID();
  const invNum = `INV-${Date.now()}`;
  await query(
    "INSERT INTO invoices (id,order_id,dealer_id,invoice_number,taxable_amount,gst_amount,total_amount,invoice_date) VALUES (?,?,?,?,?,?,?,CURDATE())",
    [id, order.id, order.dealer_id, invNum, taxable, gst, total],
  );
  await query("UPDATE orders SET status='invoiced' WHERE id=?", [order.id]);
  await auditLog({ userId, action: "generate_invoice", entityType: "invoice", entityId: id, details: { order_id: order.id, invoice_number: invNum } });
  return NextResponse.json({ data: null, error: null });
}