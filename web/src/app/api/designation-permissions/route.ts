import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(request.url);
  const designationId = url.searchParams.get("designation_id");
  if (!designationId) return NextResponse.json({ data: [], error: null });
  const rows = await query<any>(
    "SELECT module_key, permission FROM designation_permissions WHERE designation_id = ?",
    [designationId],
  );
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await request.json();
  const designationId = b.designation_id;
  if (!designationId) return NextResponse.json({ error: "designation_id required" }, { status: 400 });
  const permissions = Array.isArray(b.permissions) ? b.permissions : [];
  for (const p of permissions) {
    const moduleKey = p.module_key;
    const permission = p.permission === "on" ? "on" : "off";
    // upsert
    const existing = await query<any>(
      "SELECT id FROM designation_permissions WHERE designation_id = ? AND module_key = ?",
      [designationId, moduleKey],
    );
    if (existing.length) {
      await query(
        "UPDATE designation_permissions SET permission = ? WHERE designation_id = ? AND module_key = ?",
        [permission, designationId, moduleKey],
      );
    } else {
      await query(
        "INSERT INTO designation_permissions (id, designation_id, module_key, permission) VALUES (?,?,?,?)",
        [crypto.randomUUID(), designationId, moduleKey, permission],
      );
    }
  }
  return NextResponse.json({ data: null, error: null });
}