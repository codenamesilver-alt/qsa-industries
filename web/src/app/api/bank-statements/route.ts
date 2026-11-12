import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM bank_statements ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.statement_date) return NextResponse.json({ error: "statement_date is required" }, { status: 400 });
  if (!b.amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO bank_statements (id, statement_date, description, reference, amount, status) VALUES (?, ?,?,?,?,?)",
    [id, b.statement_date ?? null, b.description ?? null, b.reference ?? null, b.amount ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
