import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM budgets ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.budget_name) return NextResponse.json({ error: "budget_name is required" }, { status: 400 });
  if (!b.period) return NextResponse.json({ error: "period is required" }, { status: 400 });
  if (!b.amount) return NextResponse.json({ error: "amount is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO budgets (id, budget_name, period, amount, department) VALUES (?, ?,?,?,?)",
    [id, b.budget_name ?? null, b.period ?? null, b.amount ?? null, b.department ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
