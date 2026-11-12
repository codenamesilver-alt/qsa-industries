import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM exchange_rates ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.from_currency) return NextResponse.json({ error: "from_currency is required" }, { status: 400 });
  if (!b.to_currency) return NextResponse.json({ error: "to_currency is required" }, { status: 400 });
  if (!b.rate) return NextResponse.json({ error: "rate is required" }, { status: 400 });
  if (!b.rate_date) return NextResponse.json({ error: "rate_date is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO exchange_rates (id, from_currency, to_currency, rate, rate_date) VALUES (?, ?,?,?,?)",
    [id, b.from_currency ?? null, b.to_currency ?? null, b.rate ?? null, b.rate_date ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
