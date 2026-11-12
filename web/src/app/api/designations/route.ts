import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await query<any>("SELECT id, name, description, sort_order, is_active FROM designations ORDER BY sort_order, name");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  if (b.p_designation_id) {
    await query(
      "UPDATE designations SET name=?,description=?,sort_order=? WHERE id=?",
      [b.p_name, b.p_description, b.p_sort_order, b.p_designation_id],
    );
  } else {
    const id = crypto.randomUUID();
    await query(
      "INSERT INTO designations (id,name,description,sort_order,is_active) VALUES (?,?,?,?,1)",
      [id, b.p_name, b.p_description, b.p_sort_order],
    );
  }
  return NextResponse.json({ data: null, error: null });
}

export async function PATCH(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  await query("UPDATE designations SET is_active=? WHERE id=?", [b.is_active ? 1 : 0, b.id]);
  return NextResponse.json({ data: null, error: null });
}

export async function DELETE(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await request.json();
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await query("DELETE FROM designations WHERE id=?", [b.id]);
  return NextResponse.json({ data: null, error: null });
}