import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM capa ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.capa_number) return NextResponse.json({ error: "capa_number is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO capa (id, capa_number, ncr_id, root_cause, corrective_action, preventive_action, status, owner_id, due_date) VALUES (?, ?,?,?,?,?,?,?,?)",
    [id, b.capa_number ?? null, b.ncr_id ?? null, b.root_cause ?? null, b.corrective_action ?? null, b.preventive_action ?? null, b.status ?? null, b.owner_id ?? null, b.due_date ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
