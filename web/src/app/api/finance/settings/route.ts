import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','finance'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  const g = Number(b.p_ageing_grace_days);
  if (b.p_ageing_grace_days != null && (!Number.isFinite(g) || g < 0)) return NextResponse.json({ error: "Grace days must be 0 or more" }, { status: 400 });
  await query(
    `UPDATE finance_settings SET ageing_grace_days=?,ageing_bucket_1_days=?,ageing_bucket_2_days=?,ageing_bucket_3_days=?,credit_counts_current_invoices=? WHERE id=1`,
    [b.p_ageing_grace_days, b.p_ageing_bucket_1_days, b.p_ageing_bucket_2_days, b.p_ageing_bucket_3_days, b.p_credit_counts_current_invoices ? 1 : 0],
  );
  return NextResponse.json({ data: null, error: null });
}