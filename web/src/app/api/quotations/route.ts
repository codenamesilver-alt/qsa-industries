import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM quotations ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.quote_number) return NextResponse.json({ error: "quote_number is required" }, { status: 400 });
  if (!b.dealer_id) return NextResponse.json({ error: "dealer_id is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO quotations (id, quote_number, dealer_id, status, valid_until, total_amount, notes) VALUES (?, ?,?,?,?,?,?)",
    [id, b.quote_number ?? null, b.dealer_id ?? null, b.status ?? null, b.valid_until ?? null, b.total_amount ?? null, b.notes ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
