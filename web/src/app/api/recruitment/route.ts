import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM recruitment ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.candidate_name) return NextResponse.json({ error: "candidate_name is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO recruitment (id, candidate_name, email, phone, position, status) VALUES (?, ?,?,?,?,?)",
    [id, b.candidate_name ?? null, b.email ?? null, b.phone ?? null, b.position ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
