import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM notifications ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO notifications (id, user_id, title, body, link, is_read) VALUES (?, ?,?,?,?,?)",
    [id, b.user_id ?? null, b.title ?? null, b.body ?? null, b.link ?? null, b.is_read ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
