import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','inventory_manager','production_manager'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  const id = crypto.randomUUID();
  const poNum = `PO-${Date.now()}`;
  let total = 0;
  const lines = b.p_lines || [];
  const poLines: any[] = [];
  for (const l of lines) {
    const lineTotal = Number(l.quantity) * Number(l.unit_price);
    total += lineTotal;
    poLines.push({ ...l, line_total: lineTotal });
  }
  await query(
    "INSERT INTO purchase_orders (id,po_number,supplier_name,supplier_gstin,status,order_date,expected_date,total_amount,notes) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, poNum, b.p_supplier_name, b.p_supplier_gstin, "ordered", new Date().toISOString().slice(0,10), b.p_expected_date, total, b.p_notes],
  );
  for (const l of poLines) {
    await query(
      "INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)",
      [crypto.randomUUID(), id, l.product_id, l.quantity, l.unit_price, l.line_total],
    );
  }
  return NextResponse.json({ data: null, error: null });
}