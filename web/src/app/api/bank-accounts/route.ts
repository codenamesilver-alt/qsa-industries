import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM bank_accounts ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO bank_accounts (id, name, account_number, bank_name, balance, is_active) VALUES (?, ?,?,?,?,?)",
    [id, b.name ?? null, b.account_number ?? null, b.bank_name ?? null, b.balance ?? null, b.is_active ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
