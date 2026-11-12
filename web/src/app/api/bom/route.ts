import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const productId = url.searchParams.get("product_id");
  const sql = productId
    ? "SELECT b.*, p.name AS raw_material_name, p.sku AS raw_material_sku FROM bom b LEFT JOIN products p ON p.id=b.raw_material_id WHERE b.finished_product_id=?"
    : "SELECT b.*, p.name AS raw_material_name, p.sku AS raw_material_sku, fp.name AS finished_product_name FROM bom b LEFT JOIN products p ON p.id=b.raw_material_id LEFT JOIN products fp ON fp.id=b.finished_product_id ORDER BY fp.name, p.name";
  const rows = await query<any>(sql, productId ? [productId] : []);
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ["admin", "production_manager"] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await request.json();
  if (!b.finished_product_id) return NextResponse.json({ error: "Finished product required" }, { status: 400 });
  if (!b.raw_material_id) return NextResponse.json({ error: "Raw material required" }, { status: 400 });
  const qty = Number(b.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return NextResponse.json({ error: "Quantity must be positive" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO bom (id, finished_product_id, raw_material_id, quantity, unit) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE quantity=?, unit=?",
    [id, b.finished_product_id, b.raw_material_id, qty, b.unit || null, qty, b.unit || null],
  );
  return NextResponse.json({ data: { id }, error: null });
}

export async function DELETE(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ["admin", "production_manager"] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await request.json();
  await query("DELETE FROM bom WHERE finished_product_id=? AND raw_material_id=?", [b.finished_product_id, b.raw_material_id]);
  return NextResponse.json({ data: null, error: null });
}
