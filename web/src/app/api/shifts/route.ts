import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM shifts ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!b.start_time) return NextResponse.json({ error: "start_time is required" }, { status: 400 });
  if (!b.end_time) return NextResponse.json({ error: "end_time is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO shifts (id, name, start_time, end_time, is_active) VALUES (?, ?,?,?,?)",
    [id, b.name ?? null, b.start_time ?? null, b.end_time ?? null, b.is_active ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
