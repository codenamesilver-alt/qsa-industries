import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM sessions ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.user_id) return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  if (!b.token_hash) return NextResponse.json({ error: "token_hash is required" }, { status: 400 });
  if (!b.expires_at) return NextResponse.json({ error: "expires_at is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?,?,?)",
    [id, b.user_id ?? null, b.token_hash ?? null, b.expires_at ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
