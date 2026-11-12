import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM assets ORDER BY code");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ["admin", "production_manager", "inventory_manager"] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await request.json();
  if (!b.code || !b.name) return NextResponse.json({ error: "Code and name required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query("INSERT INTO assets (id, code, name, category, location, purchase_date, purchase_value, status, notes) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, b.code, b.name, b.category || null, b.location || null, b.purchase_date || null, b.purchase_value ?? null, b.status || "active", b.notes || null]);
  return NextResponse.json({ data: { id }, error: null });
}
