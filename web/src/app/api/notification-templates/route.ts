import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM notification_templates ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.code) return NextResponse.json({ error: "code is required" }, { status: 400 });
  if (!b.body) return NextResponse.json({ error: "body is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO notification_templates (id, code, subject, body) VALUES (?, ?,?,?)",
    [id, b.code ?? null, b.subject ?? null, b.body ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
