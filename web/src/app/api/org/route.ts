import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  const action = b.action;
  if (action === "create") {
    const id = crypto.randomUUID();
    await query("INSERT INTO org_positions (id,title,parent_id,sort_order) VALUES (?,?,?,?)", [id, b.p_title, b.p_parent_id, b.p_sort_order ?? 0]);
    return NextResponse.json({ data: { id }, error: null });
  }
  if (action === "update") {
    await query("UPDATE org_positions SET title=?,sort_order=? WHERE id=?", [b.p_title, b.p_sort_order, b.p_position_id]);
    return NextResponse.json({ data: null, error: null });
  }
  if (action === "move") {
    await query("UPDATE org_positions SET parent_id=? WHERE id=?", [b.p_new_parent_id, b.p_position_id]);
    return NextResponse.json({ data: null, error: null });
  }
  if (action === "delete") {
    await query("DELETE FROM org_positions WHERE id=?", [b.p_position_id]);
    return NextResponse.json({ data: null, error: null });
  }
  if (action === "clear_chart") {
    await query("DELETE FROM org_positions");
    return NextResponse.json({ data: null, error: null });
  }
  if (action === "set_reports_to") {
    await query("UPDATE users SET reports_to_id=? WHERE id=?", [b.p_reports_to_id, b.p_user_id]);
    return NextResponse.json({ data: null, error: null });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}