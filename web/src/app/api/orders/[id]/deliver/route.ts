import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','logistics'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const { id } = await params;
  const b = await request.json().catch(() => ({}));
  await query(
    "UPDATE orders SET delivery_status='delivered', delivered_at=NOW(), tracking_note=COALESCE(?,tracking_note) WHERE id=?",
    [b.p_note ?? null, id],
  );
  return NextResponse.json({ data: null, error: null });
}