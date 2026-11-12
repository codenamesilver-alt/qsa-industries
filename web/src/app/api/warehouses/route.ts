import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM warehouses ORDER BY code");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ["admin"] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await request.json();
  if (!b.code || !b.name) return NextResponse.json({ error: "Code and name required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query("INSERT INTO warehouses (id, code, name, address, is_active) VALUES (?,?,?,?,1)", [id, b.code, b.name, b.address || null]);
  return NextResponse.json({ data: { id }, error: null });
}
