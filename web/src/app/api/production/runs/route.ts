import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','production_manager'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  if (!b.target_product_id) return NextResponse.json({ error: "Product is required" }, { status: 400 });
  const qty = Number(b.output_quantity);
  if (!Number.isFinite(qty) || qty <= 0) return NextResponse.json({ error: "Output quantity must be positive" }, { status: 400 });
  if (!b.run_shift) return NextResponse.json({ error: "Shift is required" }, { status: 400 });
  if (!["pending", "passed", "failed"].includes(b.qc_status_value)) return NextResponse.json({ error: "Invalid QC status" }, { status: 400 });
  if (b.qc_status_value === "failed" && (!b.qc_notes_value || !String(b.qc_notes_value).trim())) return NextResponse.json({ error: "Failed QC requires notes" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO production_runs (id,run_date,shift,product_id,quantity_produced,qc_status,qc_notes,created_by) VALUES (?,?,?,?,?,?,?,?)",
    [id, b.run_date_value, b.run_shift, b.target_product_id, b.output_quantity, b.qc_status_value, b.qc_notes_value || null, userId],
  );
  // store material consumption
  const materials = Array.isArray(b.material_rows) ? b.material_rows : [];
  for (const m of materials) {
    if (m.product_id && Number(m.quantity) > 0) {
      await query(
        "INSERT INTO production_run_materials (id,run_id,raw_material_id,quantity_consumed,unit) VALUES (?,?,?,?,?)",
        [crypto.randomUUID(), id, m.product_id, Number(m.quantity), m.unit || null],
      );
    }
  }
  // Add finished goods stock if passed
  if (b.qc_status_value === "passed") {
    await query(
      "INSERT INTO stock_levels (product_id,current_quantity) VALUES (?,?) ON DUPLICATE KEY UPDATE current_quantity=current_quantity+?",
      [b.target_product_id, b.output_quantity, b.output_quantity],
    );
    await query(
      "INSERT INTO stock_movements (id,product_id,quantity,movement_type,source,reason) VALUES (?,?,?,?,?,?)",
      [crypto.randomUUID(), b.target_product_id, b.output_quantity, "in", "production", "Production run"],
    );
    // consume raw materials
    for (const m of materials) {
      if (m.product_id && Number(m.quantity) > 0) {
        await query(
          "INSERT INTO stock_levels (product_id,current_quantity) VALUES (?,?) ON DUPLICATE KEY UPDATE current_quantity=current_quantity-?",
          [m.product_id, 0, Number(m.quantity)],
        );
        await query(
          "INSERT INTO stock_movements (id,product_id,quantity,movement_type,source,reason) VALUES (?,?,?,?,?,?)",
          [crypto.randomUUID(), m.product_id, Number(m.quantity), "out", "production", "Production run consumption"],
        );
      }
    }
  }
  return NextResponse.json({ data: null, error: null });
}