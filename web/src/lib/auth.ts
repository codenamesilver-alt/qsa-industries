import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { queryOne } from "./db";
import { admitsRole, type UserRole } from "./roles";

export { admitsRole, isSuperuser, superuserRoles, userRoles, type UserRole } from "./roles";

const SESSION_SECRET = process.env.SESSION_SECRET || "qsa-dev-session-secret-change-in-production";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function sign(payload: string): string {
  return createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
}

export function issueSessionToken(userId: string): string {
  const expires = Date.now() + SESSION_MAX_AGE * 1000;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresStr, sig] = parts;
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return null;
  const payload = `${userId}.${expiresStr}`;
  const expected = sign(payload);
  try {
    if (!timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch {
    return null;
  }
  return userId;
}

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  dealer_id: string | null;
};

export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies();
  const token = store.get("qsa_session")?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function getProfile(): Promise<Profile | null> {
  const id = await getSessionUserId();
  if (!id) return null;
  const row = await queryOne<any>(
    "SELECT id, full_name, email, role, dealer_id FROM users WHERE id = ? AND is_active = 1",
    [id],
  );
  if (!row) return null;
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role: row.role as UserRole,
    dealer_id: row.dealer_id,
  };
}

export async function requireProfile(allowedRoles: readonly UserRole[]) {
  const profile = await getProfile();
  if (!profile) {
    redirect("/login");
  }
  if (!admitsRole(profile.role, allowedRoles)) {
    redirect("/unauthorized");
  }
  return profile;
}

export function roleLabel(role: UserRole) {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}