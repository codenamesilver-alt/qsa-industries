import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { queryOne } from "@/lib/db";
import { cookies } from "next/headers";
import { issueSessionToken } from "@/lib/auth";
import { auditLog } from "@/lib/audit";

// Simple in-memory rate limiter (per IP). Resets on server restart.
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 0, resetAt: now + WINDOW_MS });
    return true;
  }
  return rec.count < MAX_ATTEMPTS;
}

function recordFailure(ip: string) {
  const rec = attempts.get(ip);
  if (rec) rec.count += 1;
}

function clearAttempts(ip: string) {
  attempts.delete(ip);
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }
  const { email, password } = await request.json();
  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }
  const row = await queryOne<any>(
    "SELECT id, full_name, email, role, dealer_id, password_hash, is_active FROM users WHERE email = ?",
    [email],
  );
  if (!row || !row.is_active) {
    recordFailure(ip);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  const ok = row.password_hash
    ? await bcrypt.compare(password, row.password_hash)
    : false;
  if (!ok) {
    recordFailure(ip);
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  clearAttempts(ip);
  await auditLog({ userId: row.id, action: "login", entityType: "user", entityId: row.id, ip });
  const store = await cookies();
  store.set("qsa_session", issueSessionToken(row.id), {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
  });
  return NextResponse.json({
    data: { user: { id: row.id } },
    profile: { id: row.id, full_name: row.full_name, email: row.email, role: row.role, dealer_id: row.dealer_id },
  });
}