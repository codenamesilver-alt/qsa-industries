import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['dealer','admin','sales_rep','sales_manager','sales_director'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const { id } = await params;
  const rows = await query<any>(
    "SELECT p.id AS product_id, p.sku, p.name AS product_name, p.category, p.unit_of_measure, p.price AS list_price, p.price AS unit_price, COALESCE(s.current_quantity,0) AS available_quantity FROM products p LEFT JOIN stock_levels s ON s.product_id=p.id WHERE p.active=1 AND p.is_sellable=1",
  );
  return NextResponse.json({ data: rows, error: null });
}