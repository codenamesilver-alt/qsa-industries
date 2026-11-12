import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM gl_accounts ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.code) return NextResponse.json({ error: "code is required" }, { status: 400 });
  if (!b.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!b.account_type) return NextResponse.json({ error: "account_type is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO gl_accounts (id, code, name, account_type, parent_id, is_active) VALUES (?, ?,?,?,?,?)",
    [id, b.code ?? null, b.name ?? null, b.account_type ?? null, b.parent_id ?? null, b.is_active ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
