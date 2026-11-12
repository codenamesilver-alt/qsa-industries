import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM notification_channels ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.channel) return NextResponse.json({ error: "channel is required" }, { status: 400 });
  if (!b.address) return NextResponse.json({ error: "address is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO notification_channels (id, user_id, channel, address, is_active) VALUES (?, ?,?,?,?)",
    [id, b.user_id ?? null, b.channel ?? null, b.address ?? null, b.is_active ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
