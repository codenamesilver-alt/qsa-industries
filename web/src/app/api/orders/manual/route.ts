import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','sales_rep','sales_manager','sales_director'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();

  const dealer = await queryOne<any>("SELECT * FROM dealers WHERE id=?", [b.dealer_id]);
  if (!dealer) return NextResponse.json({ error: "Dealer not found" }, { status: 404 });

  const lines = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length === 0) return NextResponse.json({ error: "At least one line required" }, { status: 400 });

  const repId = dealer.sales_rep_id || "10000000-0000-4000-8000-000000000005";

  let total = 0;
  for (const l of lines) {
    const qty = Number(l.quantity);
    const price = Number(l.unit_price);
    if (!Number.isFinite(qty) || qty <= 0) return NextResponse.json({ error: "Invalid quantity" }, { status: 400 });
    if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: "Invalid price" }, { status: 400 });
    total += qty * price;
  }

  const orderId = crypto.randomUUID();
  const status = b.status || "approved";
  await query(
    "INSERT INTO orders (id,dealer_id,sales_rep_id,status,total_amount,credit_override,requested_delivery_date,delivery_status,created_at) VALUES (?,?,?,?,?,?,?,?,NOW())",
    [orderId, dealer.id, repId, status, total.toFixed(2), 0, b.requested_delivery_date || null, "awaiting_dispatch"],
  );

  for (const l of lines) {
    await query(
      "INSERT INTO order_items (id,order_id,product_id,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)",
      [crypto.randomUUID(), orderId, l.product_id, Number(l.quantity).toFixed(2), Number(l.unit_price).toFixed(2), (Number(l.quantity) * Number(l.unit_price)).toFixed(2)],
    );
  }

  return NextResponse.json({ data: { id: orderId }, error: null });
}
