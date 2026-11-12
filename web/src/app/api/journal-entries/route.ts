import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM journal_entries ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.entry_number) return NextResponse.json({ error: "entry_number is required" }, { status: 400 });
  if (!b.entry_date) return NextResponse.json({ error: "entry_date is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO journal_entries (id, entry_number, entry_date, description, status) VALUES (?, ?,?,?,?)",
    [id, b.entry_number ?? null, b.entry_date ?? null, b.description ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
