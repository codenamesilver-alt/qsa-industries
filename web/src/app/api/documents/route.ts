import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM documents ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!b.file_path) return NextResponse.json({ error: "file_path is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO documents (id, folder_id, name, file_path, mime_type, size_bytes, version, uploaded_by) VALUES (?, ?,?,?,?,?,?,?)",
    [id, b.folder_id ?? null, b.name ?? null, b.file_path ?? null, b.mime_type ?? null, b.size_bytes ?? null, b.version ?? null, b.uploaded_by ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
