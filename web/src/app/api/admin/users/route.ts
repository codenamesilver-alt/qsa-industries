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
  // password reset
  if (b.p_password && b.p_user_id && !b.p_email) {
    if (String(b.p_password).length < 6) return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    const hash = await bcrypt.hash(b.p_password, 10);
    await query("UPDATE users SET password_hash=? WHERE id=?", [hash, b.p_user_id]);
    return NextResponse.json({ data: null, error: null });
  }
  // create new user account
  if (b.p_email && !b.p_user_id) {
    if (!b.p_full_name || !String(b.p_full_name).trim()) return NextResponse.json({ error: "Full name is required" }, { status: 400 });
    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(String(b.p_email))) return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    if (!b.p_role) return NextResponse.json({ error: "Role is required" }, { status: 400 });
    const pwd = b.p_password || "Qsa@Demo2026";
    if (String(pwd).length < 6) return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    const hash = await bcrypt.hash(pwd, 10);
    await query(
      `INSERT INTO users (id,full_name,email,role,is_active,phone,password_hash) VALUES (?,?,?,?,?,?,?)`,
      [crypto.randomUUID(), String(b.p_full_name).trim(), String(b.p_email).trim().toLowerCase(), b.p_role, b.p_is_active ? 1 : 0, b.p_phone, hash],
    );
    return NextResponse.json({ data: null, error: null });
  }
  // profile upsert
  if (!b.p_user_id) return NextResponse.json({ error: "User id is required" }, { status: 400 });
  if (!b.p_full_name || !String(b.p_full_name).trim()) return NextResponse.json({ error: "Full name is required" }, { status: 400 });
  if (!b.p_role) return NextResponse.json({ error: "Role is required" }, { status: 400 });
  await query(
    `UPDATE users SET full_name=?, role=?, is_active=?, dealer_id=?, phone=? WHERE id=?`,
    [String(b.p_full_name).trim(), b.p_role, b.p_is_active ? 1 : 0, b.p_dealer_id, b.p_phone, b.p_user_id],
  );
  return NextResponse.json({ data: null, error: null });
}