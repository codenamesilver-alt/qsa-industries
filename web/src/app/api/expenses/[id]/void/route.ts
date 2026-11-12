import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','finance'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const { id } = await params;
  const body = await request.json();
  const { p_void_reason } = body;
  if (!p_void_reason || !p_void_reason.trim()) {
    return NextResponse.json({ error: "A void needs a reason" }, { status: 400 });
  }
  const row = await queryOne<any>("SELECT voided_at FROM expense_ledger WHERE id=?", [id]);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.voided_at) return NextResponse.json({ error: `Already voided` }, { status: 400 });
  await query("UPDATE expense_ledger SET void_reason=?, voided_at=NOW() WHERE id=?", [p_void_reason.trim(), id]);
  return NextResponse.json({ data: null, error: null });
}