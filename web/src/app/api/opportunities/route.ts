import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM opportunities ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO opportunities (id, lead_id, dealer_id, title, stage, value, probability, expected_close, owner_id) VALUES (?, ?,?,?,?,?,?,?,?)",
    [id, b.lead_id ?? null, b.dealer_id ?? null, b.title ?? null, b.stage ?? null, b.value ?? null, b.probability ?? null, b.expected_close ?? null, b.owner_id ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
