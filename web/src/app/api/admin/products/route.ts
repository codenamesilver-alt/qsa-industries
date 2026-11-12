import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  if (!b.p_sku || !String(b.p_sku).trim()) return NextResponse.json({ error: "SKU is required" }, { status: 400 });
  if (!b.p_name || !String(b.p_name).trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!b.p_category || !String(b.p_category).trim()) return NextResponse.json({ error: "Category is required" }, { status: 400 });
  if (!b.p_unit_of_measure || !String(b.p_unit_of_measure).trim()) return NextResponse.json({ error: "Unit of measure is required" }, { status: 400 });
  const price = Number(b.p_price);
  if (!Number.isFinite(price) || price < 0) return NextResponse.json({ error: "Price must be 0 or more" }, { status: 400 });
  const thr = Number(b.p_low_stock_threshold);
  if (!Number.isFinite(thr) || thr < 0) return NextResponse.json({ error: "Low stock threshold must be 0 or more" }, { status: 400 });
  if (b.p_hsn_code && !/^[0-9]{4}([0-9]{2})?([0-9]{2})?$/.test(String(b.p_hsn_code).trim())) return NextResponse.json({ error: "Invalid HSN code" }, { status: 400 });
  if (b.p_product_id) {
    await query(
      `UPDATE products SET sku=?,name=?,category=?,unit_of_measure=?,price=?,hsn_code=?,low_stock_threshold=?,is_sellable=?,active=? WHERE id=?`,
      [b.p_sku,b.p_name,b.p_category,b.p_unit_of_measure,b.p_price,b.p_hsn_code,b.p_low_stock_threshold,b.p_is_sellable?1:0,b.p_active?1:0,b.p_product_id],
    );
  } else {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO products (id,sku,name,category,unit_of_measure,price,hsn_code,low_stock_threshold,is_sellable,active) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id,b.p_sku,b.p_name,b.p_category,b.p_unit_of_measure,b.p_price,b.p_hsn_code,b.p_low_stock_threshold,b.p_is_sellable?1:0,b.p_active?1:0],
    );
  }
  return NextResponse.json({ data: null, error: null });
}