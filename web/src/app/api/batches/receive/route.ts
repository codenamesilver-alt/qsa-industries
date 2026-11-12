import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','production_manager','inventory_manager'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO production_batches (id,product_id,batch_code,manufacture_date,expiry_date,available_quantity) VALUES (?,?,?,?,?,?)",
    [id, b.p_product_id, b.p_batch_code, b.p_manufacture_date, b.p_expiry_date, b.p_quantity],
  );
  await query(
    "INSERT INTO stock_movements (id,product_id,quantity,movement_type,source,reason) VALUES (?,?,?,?,?,?)",
    [crypto.randomUUID(), b.p_product_id, b.p_quantity, "in", b.p_source || "production", b.p_reason],
  );
  await query(
    "INSERT INTO stock_levels (product_id,current_quantity) VALUES (?,?) ON DUPLICATE KEY UPDATE current_quantity=current_quantity+?",
    [b.p_product_id, b.p_quantity, b.p_quantity],
  );
  return NextResponse.json({ data: null, error: null });
}