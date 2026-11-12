import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM tax_declarations ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.employee_id) return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
  if (!b.financial_year) return NextResponse.json({ error: "financial_year is required" }, { status: 400 });
  if (!b.declaration_type) return NextResponse.json({ error: "declaration_type is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO tax_declarations (id, employee_id, financial_year, declaration_type, amount, status) VALUES (?, ?,?,?,?,?)",
    [id, b.employee_id ?? null, b.financial_year ?? null, b.declaration_type ?? null, b.amount ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
