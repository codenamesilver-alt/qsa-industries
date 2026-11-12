import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  const hash = await bcrypt.hash(b.password, 10);
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO users (id,full_name,email,role,dealer_id,is_active,password_hash) VALUES (?,?,?,?,?,?,?)",
    [id, b.full_name, b.email, "dealer", b.dealer_id, true, hash],
  );
  return NextResponse.json({ data: null, error: null });
}