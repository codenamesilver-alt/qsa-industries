import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM product_images ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  if (!b.product_id) return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  if (!b.file_path) return NextResponse.json({ error: "file_path is required" }, { status: 400 });
  const id = crypto.randomUUID();
  await query(
    "INSERT INTO product_images (id, product_id, file_path, is_primary) VALUES (?, ?,?,?)",
    [id, b.product_id ?? null, b.file_path ?? null, b.is_primary ?? null],
  );
  return NextResponse.json({ data: { id }, error: null });
}
