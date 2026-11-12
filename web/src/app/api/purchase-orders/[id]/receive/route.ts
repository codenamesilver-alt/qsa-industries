import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','inventory_manager','production_manager'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const { id } = await params;
  const b = await request.json();
  const lines = b.p_lines || [];
  for (const l of lines) {
    const line = await queryOne<any>("SELECT product_id, quantity, quantity_received FROM purchase_order_lines WHERE id=?", [l.line_id]);
    if (!line) continue;
    const newReceived = Number(line.quantity_received) + Number(l.quantity);
    await query("UPDATE purchase_order_lines SET quantity_received=? WHERE id=?", [newReceived, l.line_id]);
    await query(
      "INSERT INTO stock_movements (id,product_id,quantity,movement_type,source,reason) VALUES (?,?,?,?,?,?)",
      [crypto.randomUUID(), line.product_id, l.quantity, "in", "purchase", "PO receive"],
    );
    await query(
      "INSERT INTO stock_levels (product_id,current_quantity) VALUES (?,?) ON DUPLICATE KEY UPDATE current_quantity=current_quantity+?",
      [line.product_id, l.quantity, l.quantity],
    );
  }
  return NextResponse.json({ data: null, error: null });
}