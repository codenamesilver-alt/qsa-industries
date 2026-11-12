import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM sampling_plans ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.product_id) return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  if (!b.plan_name) return NextResponse.json({ error: "plan_name is required" }, { status: 400 });
  if (!b.sample_size) return NextResponse.json({ error: "sample_size is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO sampling_plans (id, product_id, plan_name, sample_size, frequency, is_active) VALUES (?, ?,?,?,?,?)",
    [id, b.product_id ?? null, b.plan_name ?? null, b.sample_size ?? null, b.frequency ?? null, b.is_active ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
