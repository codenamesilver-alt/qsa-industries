import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM communications ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.comm_type) return NextResponse.json({ error: "comm_type is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO communications (id, dealer_id, user_id, comm_type, subject, notes, comm_date) VALUES (?, ?,?,?,?,?,?)",
    [id, b.dealer_id ?? null, b.user_id ?? null, b.comm_type ?? null, b.subject ?? null, b.notes ?? null, b.comm_date ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
