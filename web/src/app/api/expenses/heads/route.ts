import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','finance'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const body = await request.json();
  const { p_name, p_description, p_sort_order, p_head_id } = body;
  if (p_head_id) {
    await query(
      "UPDATE expense_heads SET name=?, description=?, sort_order=? WHERE id=?",
      [p_name, p_description, p_sort_order, p_head_id],
    );
  } else {
    const id = crypto.randomUUID();
    await query(
      "INSERT INTO expense_heads (id, name, description, sort_order, is_active) VALUES (?,?,?,?,1)",
      [id, p_name, p_description, p_sort_order],
    );
  }
  return NextResponse.json({ data: null, error: null });
}

export async function PATCH(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin', 'finance'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const body = await request.json();
  const { p_head_id, p_is_active } = body;
  await query("UPDATE expense_heads SET is_active=? WHERE id=?", [p_is_active ? 1 : 0, p_head_id]);
  return NextResponse.json({ data: null, error: null });
}