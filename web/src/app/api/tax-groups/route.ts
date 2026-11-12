import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM tax_groups ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!b.rate) return NextResponse.json({ error: "rate is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO tax_groups (id, name, rate, hsn_code, is_active) VALUES (?, ?,?,?,?)",
    [id, b.name ?? null, b.rate ?? null, b.hsn_code ?? null, b.is_active ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
