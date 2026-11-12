import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','sales_rep','sales_manager','sales_director'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  await query("UPDATE dealers SET sales_rep_id=? WHERE id=?", [b.p_sales_rep_id, b.p_dealer_id]);
  return NextResponse.json({ data: null, error: null });
}