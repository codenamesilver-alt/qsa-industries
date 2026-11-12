import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM user_preferences ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.user_id) return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  if (!b.pref_key) return NextResponse.json({ error: "pref_key is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO user_preferences (id, user_id, pref_key, pref_value) VALUES (?, ?,?,?)",
    [id, b.user_id ?? null, b.pref_key ?? null, b.pref_value ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
