import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM visit_reports ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.sales_rep_id) return NextResponse.json({ error: "sales_rep_id is required" }, { status: 400 });
  if (!b.visit_date) return NextResponse.json({ error: "visit_date is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO visit_reports (id, sales_rep_id, dealer_id, visit_date, purpose, notes, outcome) VALUES (?, ?,?,?,?,?,?)",
    [id, b.sales_rep_id ?? null, b.dealer_id ?? null, b.visit_date ?? null, b.purpose ?? null, b.notes ?? null, b.outcome ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
