import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['dealer','admin','sales_rep'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  let dealerId = b.p_dealer_id;
  if (!dealerId) {
    const user = await queryOne<any>("SELECT dealer_id FROM users WHERE id=?", [userId]);
    dealerId = user?.dealer_id;
  }
  if (!dealerId) return NextResponse.json({ error: "No dealer linked" }, { status: 400 });
  const dealer = await queryOne<any>("SELECT sales_rep_id FROM dealers WHERE id=?", [dealerId]);
  const repId = dealer?.sales_rep_id || userId;
  const lines = b.order_lines || [];
  // get product prices
  let total = 0;
  const items: any[] = [];
  for (const l of lines) {
    const p = await queryOne<any>("SELECT price FROM products WHERE id=?", [l.product_id]);
    const price = Number(p?.price ?? 0);
    const lineTotal = price * Number(l.quantity);
    total += lineTotal;
    items.push({ product_id: l.product_id, quantity: l.quantity, unit_price: price, line_total: lineTotal });
  }
  const orderId = crypto.randomUUID();
  await query(
    "INSERT INTO orders (id,dealer_id,sales_rep_id,status,total_amount) VALUES (?,?,?,?,?)",
    [orderId, dealerId, repId, "pending", total],
  );
  for (const it of items) {
    await query(
      "INSERT INTO order_items (id,order_id,product_id,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)",
      [crypto.randomUUID(), orderId, it.product_id, it.quantity, it.unit_price, it.line_total],
    );
  }
  return NextResponse.json({ data: null, error: null });
}