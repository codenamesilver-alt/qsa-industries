import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM cheque_management ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.cheque_number) return NextResponse.json({ error: "cheque_number is required" }, { status: 400 });
  if (!b.amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO cheque_management (id, cheque_number, bank_account_id, payee, amount, status, issue_date, clearance_date) VALUES (?, ?,?,?,?,?,?,?)",
    [id, b.cheque_number ?? null, b.bank_account_id ?? null, b.payee ?? null, b.amount ?? null, b.status ?? null, b.issue_date ?? null, b.clearance_date ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
