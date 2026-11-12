import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','inventory_manager','production_manager'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  const { target_product_id, adjustment_quantity, adjustment_movement_type, adjustment_reason } = b;
  if (!target_product_id) return NextResponse.json({ error: "Product is required" }, { status: 400 });
  const qty = Number(adjustment_quantity);
  if (!Number.isFinite(qty) || qty <= 0) return NextResponse.json({ error: "Quantity must be positive" }, { status: 400 });
  if (adjustment_movement_type !== "in" && adjustment_movement_type !== "out") return NextResponse.json({ error: "Movement type must be in or out" }, { status: 400 });
  if (!adjustment_reason || !String(adjustment_reason).trim()) return NextResponse.json({ error: "Reason is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO stock_movements (id,product_id,quantity,movement_type,source,reason) VALUES (?,?,?,?,?,?)",
    [id, target_product_id, qty, adjustment_movement_type, "adjustment", adjustment_reason],
  );
  // update level
  const delta = adjustment_movement_type === "in" ? qty : -qty;
  await query(
    "INSERT INTO stock_levels (product_id,current_quantity) VALUES (?,?) ON DUPLICATE KEY UPDATE current_quantity=current_quantity+?",
    [target_product_id, delta, delta],
  );
  return NextResponse.json({ data: null, error: null });
}