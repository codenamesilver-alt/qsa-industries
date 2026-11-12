import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  if (b.p_price_list_id) {
    await query(
      "UPDATE price_lists SET product_id=?,dealer_id=?,price_tier=?,price=?,valid_from=?,valid_to=? WHERE id=?",
      [b.p_product_id, b.p_dealer_id, b.p_price_tier, b.p_price, b.p_valid_from, b.p_valid_to, b.p_price_list_id],
    );
  } else {
    const id = crypto.randomUUID();
    await query(
      "INSERT INTO price_lists (id,product_id,dealer_id,price_tier,price,valid_from,valid_to) VALUES (?,?,?,?,?,?,?)",
      [id, b.p_product_id, b.p_dealer_id, b.p_price_tier, b.p_price, b.p_valid_from, b.p_valid_to],
    );
  }
  return NextResponse.json({ data: null, error: null });
}

export async function DELETE(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  await query("DELETE FROM price_lists WHERE id=?", [b.p_price_list_id]);
  return NextResponse.json({ data: null, error: null });
}