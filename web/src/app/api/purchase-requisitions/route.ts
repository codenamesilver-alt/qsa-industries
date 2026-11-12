import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM purchase_requisitions ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.pr_number) return NextResponse.json({ error: "pr_number is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO purchase_requisitions (id, pr_number, requested_by, department, status, notes) VALUES (?, ?,?,?,?,?)",
    [id, b.pr_number ?? null, b.requested_by ?? null, b.department ?? null, b.status ?? null, b.notes ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
