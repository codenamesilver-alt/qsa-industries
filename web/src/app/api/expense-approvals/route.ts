import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM expense_approvals ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.expense_id) return NextResponse.json({ error: "expense_id is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO expense_approvals (id, expense_id, approver_id, status, notes) VALUES (?, ?,?,?,?)",
    [id, b.expense_id ?? null, b.approver_id ?? null, b.status ?? null, b.notes ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
