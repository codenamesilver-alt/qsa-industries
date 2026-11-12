import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM demand_forecasts ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.product_id) return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  if (!b.period) return NextResponse.json({ error: "period is required" }, { status: 400 });
  if (!b.forecast_qty) return NextResponse.json({ error: "forecast_qty is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO demand_forecasts (id, product_id, period, forecast_qty, actual_qty) VALUES (?, ?,?,?,?)",
    [id, b.product_id ?? null, b.period ?? null, b.forecast_qty ?? null, b.actual_qty ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
