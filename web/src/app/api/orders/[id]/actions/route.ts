import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','sales_rep','sales_manager','sales_director','logistics'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const { id } = await params;
  const b = await request.json();
  const action = b.action;
  if (action === "approve" || action === "override") {
    await query("UPDATE orders SET status='approved', credit_override=? WHERE id=?", [action === "override" ? 1 : 0, id]);
  } else if (action === "escalate") {
    await query("UPDATE orders SET status='pending_director_approval' WHERE id=?", [id]);
  } else if (action === "director_approve") {
    await query("UPDATE orders SET status='approved' WHERE id=?", [id]);
  } else if (action === "director_reject") {
    await query("UPDATE orders SET status='rejected' WHERE id=?", [id]);
  } else if (action === "dispatch") {
    await query("UPDATE orders SET status='dispatched', dispatch_date=?, tracking_note=? WHERE id=?", [b.dispatch_date_value, b.dispatch_note, id]);
  }
  return NextResponse.json({ data: null, error: null });
}