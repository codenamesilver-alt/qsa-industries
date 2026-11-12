import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM audit_diff ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.audit_log_id) return NextResponse.json({ error: "audit_log_id is required" }, { status: 400 });
  if (!b.field_name) return NextResponse.json({ error: "field_name is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO audit_diff (id, audit_log_id, field_name, old_value, new_value) VALUES (?, ?,?,?,?)",
    [id, b.audit_log_id ?? null, b.field_name ?? null, b.old_value ?? null, b.new_value ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
