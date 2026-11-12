import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM vehicles ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.code) return NextResponse.json({ error: "code is required" }, { status: 400 });
  if (!b.vehicle_number) return NextResponse.json({ error: "vehicle_number is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO vehicles (id, code, vehicle_number, driver_name, capacity, status) VALUES (?, ?,?,?,?,?)",
    [id, b.code ?? null, b.vehicle_number ?? null, b.driver_name ?? null, b.capacity ?? null, b.status ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
