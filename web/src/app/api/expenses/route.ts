import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','finance'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const body = await request.json();
  const {
    p_head_id, p_amount, p_expense_date, p_vendor, p_mode, p_reference,
    p_taxable_amount, p_tax_amount, p_attachment_path, p_notes,
  } = body;
  if (!p_head_id) return NextResponse.json({ error: "Expense head is required" }, { status: 400 });
  const amt = Number(p_amount);
  if (!Number.isFinite(amt) || amt <= 0) return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
  if (!p_expense_date) return NextResponse.json({ error: "Expense date is required" }, { status: 400 });
  if (!p_mode) return NextResponse.json({ error: "Payment mode is required" }, { status: 400 });
  if (p_taxable_amount != null && p_tax_amount != null) {
    const sum = Number(p_taxable_amount) + Number(p_tax_amount);
    if (Math.round(sum * 100) !== Math.round(Number(p_amount) * 100)) {
      return NextResponse.json({ error: "Tax split does not reconcile to amount" }, { status: 400 });
    }
  }
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO expense_ledger (id, head_id, expense_date, amount, payment_mode, reference, notes, attachment_path, created_at)
     VALUES (?,?,?,?,?,?,?, ?,NOW())`,
    [id, p_head_id, p_expense_date, p_amount, p_mode, p_reference, p_notes, p_attachment_path || null],
  );
  return NextResponse.json({ data: null, error: null });
}