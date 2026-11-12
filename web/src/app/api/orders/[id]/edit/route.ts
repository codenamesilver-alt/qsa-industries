import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','sales_rep'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const { id } = await params;
  const b = await request.json();
  const lines = b.order_lines || [];
  // delete old items
  await query("DELETE FROM order_items WHERE order_id=?", [id]);
  let total = 0;
  for (const l of lines) {
    const p = await queryOne<any>("SELECT price FROM products WHERE id=?", [l.product_id]) as any;
    const price = Number(p?.price ?? 0);
    const lineTotal = price * Number(l.quantity);
    total += lineTotal;
    await query(
      "INSERT INTO order_items (id,order_id,product_id,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)",
      [crypto.randomUUID(), id, l.product_id, l.quantity, price, lineTotal],
    );
  }
  await query("UPDATE orders SET total_amount=?, requested_delivery_date=? WHERE id=?", [total, b.p_requested_delivery_date, id]);
  return NextResponse.json({ data: null, error: null });
}