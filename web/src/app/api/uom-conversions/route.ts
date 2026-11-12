import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM uom_conversions ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.from_uom) return NextResponse.json({ error: "from_uom is required" }, { status: 400 });
  if (!b.to_uom) return NextResponse.json({ error: "to_uom is required" }, { status: 400 });
  if (!b.factor) return NextResponse.json({ error: "factor is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO uom_conversions (id, from_uom, to_uom, factor) VALUES (?, ?,?,?)",
    [id, b.from_uom ?? null, b.to_uom ?? null, b.factor ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
