import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM deviations ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.deviation_number) return NextResponse.json({ error: "deviation_number is required" }, { status: 400 });
  if (!b.description) return NextResponse.json({ error: "description is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO deviations (id, deviation_number, description, severity, status) VALUES (?, ?,?,?,?)",
    [id, b.deviation_number ?? null, b.description ?? null, b.severity ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
