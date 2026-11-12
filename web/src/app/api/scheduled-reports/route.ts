import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM scheduled_reports ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.report_name) return NextResponse.json({ error: "report_name is required" }, { status: 400 });
  if (!b.schedule) return NextResponse.json({ error: "schedule is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO scheduled_reports (id, report_name, schedule, recipients, is_active) VALUES (?, ?,?,?,?)",
    [id, b.report_name ?? null, b.schedule ?? null, b.recipients ?? null, b.is_active ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
