import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM suppliers ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO suppliers (id, name, contact_person, phone, email, gstin, address, payment_terms, lead_time_days, rating, is_active) VALUES (?, ?,?,?,?,?,?,?,?,?,?)",
    [id, b.name ?? null, b.contact_person ?? null, b.phone ?? null, b.email ?? null, b.gstin ?? null, b.address ?? null, b.payment_terms ?? null, b.lead_time_days ?? null, b.rating ?? null, b.is_active ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
