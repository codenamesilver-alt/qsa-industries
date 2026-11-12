import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM backup_log ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.backup_type) return NextResponse.json({ error: "backup_type is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO backup_log (id, backup_type, file_path, size_bytes, status) VALUES (?, ?,?,?,?)",
    [id, b.backup_type ?? null, b.file_path ?? null, b.size_bytes ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
