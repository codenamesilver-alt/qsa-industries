import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','production_manager','qc_staff'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  await query("UPDATE production_runs SET qc_status=?, qc_notes=? WHERE id=?", [b.qc_status, b.qc_notes || null, b.run_id]);
  return NextResponse.json({ data: null, error: null });
}