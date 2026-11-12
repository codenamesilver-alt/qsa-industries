import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM rfq ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.rfq_number) return NextResponse.json({ error: "rfq_number is required" }, { status: 400 });
  if (!b.title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO rfq (id, rfq_number, title, status) VALUES (?, ?,?,?)",
    [id, b.rfq_number ?? null, b.title ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
