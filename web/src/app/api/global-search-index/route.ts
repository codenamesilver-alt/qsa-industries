import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM global_search_index ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.entity_type) return NextResponse.json({ error: "entity_type is required" }, { status: 400 });
  if (!b.entity_id) return NextResponse.json({ error: "entity_id is required" }, { status: 400 });
  if (!b.title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO global_search_index (id, entity_type, entity_id, title, body) VALUES (?, ?,?,?,?)",
    [id, b.entity_type ?? null, b.entity_id ?? null, b.title ?? null, b.body ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
