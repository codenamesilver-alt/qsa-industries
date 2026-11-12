import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM leads ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO leads (id, name, company, email, phone, source, status, owner_id, notes) VALUES (?, ?,?,?,?,?,?,?,?)",
    [id, b.name ?? null, b.company ?? null, b.email ?? null, b.phone ?? null, b.source ?? null, b.status ?? null, b.owner_id ?? null, b.notes ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
