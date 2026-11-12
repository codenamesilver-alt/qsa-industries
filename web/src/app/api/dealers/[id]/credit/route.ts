import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','finance'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const { id } = await params;
  const b = await request.json();
  const patch = b.patch || {};
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k}=?`);
    vals.push(v);
  }
  if (sets.length) {
    vals.push(id);
    await query(`UPDATE dealers SET ${sets.join(",")} WHERE id=?`, vals);
  }
  return NextResponse.json({ data: null, error: null });
}