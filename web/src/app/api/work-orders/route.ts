import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM work_orders ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.wo_number) return NextResponse.json({ error: "wo_number is required" }, { status: 400 });
  if (!b.product_id) return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  if (!b.quantity) return NextResponse.json({ error: "quantity is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO work_orders (id, wo_number, product_id, quantity, status, start_date, due_date, work_center_id) VALUES (?, ?,?,?,?,?,?,?)",
    [id, b.wo_number ?? null, b.product_id ?? null, b.quantity ?? null, b.status ?? null, b.start_date ?? null, b.due_date ?? null, b.work_center_id ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
