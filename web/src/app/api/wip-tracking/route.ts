import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM wip_tracking ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.work_order_id) return NextResponse.json({ error: "work_order_id is required" }, { status: 400 });
  if (!b.stage) return NextResponse.json({ error: "stage is required" }, { status: 400 });
  if (!b.quantity) return NextResponse.json({ error: "quantity is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO wip_tracking (id, work_order_id, stage, quantity) VALUES (?, ?,?,?)",
    [id, b.work_order_id ?? null, b.stage ?? null, b.quantity ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
