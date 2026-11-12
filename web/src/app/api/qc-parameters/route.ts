import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM qc_parameters WHERE is_active=1 ORDER BY sort_order, name");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ["admin", "qc_staff", "production_manager"] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await request.json();
  if (!b.name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query("INSERT INTO qc_parameters (id,name,unit,min_value,max_value,is_active,sort_order) VALUES (?,?,?,?,?,?,?)",
    [id, b.name, b.unit || null, b.min_value ?? null, b.max_value ?? null, b.is_active ? 1 : 1, b.sort_order ?? 0]);
  return NextResponse.json({ data: { id }, error: null });
}
