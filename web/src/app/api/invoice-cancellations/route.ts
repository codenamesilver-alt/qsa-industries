import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM invoice_cancellations ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.invoice_id) return NextResponse.json({ error: "invoice_id is required" }, { status: 400 });
  if (!b.reason) return NextResponse.json({ error: "reason is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO invoice_cancellations (id, invoice_id, reason, cancelled_by) VALUES (?, ?,?,?)",
    [id, b.invoice_id ?? null, b.reason ?? null, b.cancelled_by ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
