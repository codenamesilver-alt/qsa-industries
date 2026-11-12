import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM departments ORDER BY name");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ["admin"] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await request.json();
  if (!b.name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query("INSERT INTO departments (id, name, description, is_active) VALUES (?,?,?,?)",
    [id, b.name, b.description || null, b.is_active != null ? (b.is_active ? 1 : 0) : 1]);
  return NextResponse.json({ data: { id }, error: null });
}

export async function DELETE(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ["admin"] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await request.json();
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await query("DELETE FROM departments WHERE id=?", [b.id]);
  return NextResponse.json({ data: null, error: null });
}
