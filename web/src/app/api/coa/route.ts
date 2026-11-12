import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM coa ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.coa_number) return NextResponse.json({ error: "coa_number is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO coa (id, production_run_id, batch_id, coa_number, issued_at, issued_by, file_path) VALUES (?, ?,?,?,?,?,?)",
    [id, b.production_run_id ?? null, b.batch_id ?? null, b.coa_number ?? null, b.issued_at ?? null, b.issued_by ?? null, b.file_path ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
