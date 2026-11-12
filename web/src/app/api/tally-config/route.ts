import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM tally_config ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();

  const id = crypto.randomUUID();
  await query(
    "INSERT INTO tally_config (id, voucher_type, gst_split_mode, voucher_numbering, xml_format, period_convention) VALUES (?, ?,?,?,?,?)",
    [id, b.voucher_type ?? null, b.gst_split_mode ?? null, b.voucher_numbering ?? null, b.xml_format ?? null, b.period_convention ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
