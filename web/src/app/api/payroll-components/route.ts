import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM payroll_components ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!b.component_type) return NextResponse.json({ error: "component_type is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO payroll_components (id, name, component_type, is_taxable, is_active) VALUES (?, ?,?,?,?)",
    [id, b.name ?? null, b.component_type ?? null, b.is_taxable ?? null, b.is_active ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
