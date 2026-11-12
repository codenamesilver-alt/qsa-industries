import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM bom_versions ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.finished_product_id) return NextResponse.json({ error: "finished_product_id is required" }, { status: 400 });
  if (!b.version) return NextResponse.json({ error: "version is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO bom_versions (id, finished_product_id, version, effective_from, effective_to, is_active) VALUES (?, ?,?,?,?,?)",
    [id, b.finished_product_id ?? null, b.version ?? null, b.effective_from ?? null, b.effective_to ?? null, b.is_active ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
