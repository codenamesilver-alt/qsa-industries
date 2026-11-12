import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM calibration_records ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.calibration_date) return NextResponse.json({ error: "calibration_date is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO calibration_records (id, equipment_id, calibration_date, next_due, result, performed_by, notes) VALUES (?, ?,?,?,?,?,?)",
    [id, b.equipment_id ?? null, b.calibration_date ?? null, b.next_due ?? null, b.result ?? null, b.performed_by ?? null, b.notes ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
