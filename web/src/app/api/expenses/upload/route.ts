import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getProfile, admitsRole } from "@/lib/auth";

const ALLOWED = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ["admin", "finance"] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await request.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (!ALLOWED.includes(file.type)) return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 });

  const ext = file.name.split(".").pop() || "bin";
  const safeName = `${crypto.randomUUID()}.${ext}`;
  const dir = join(process.cwd(), "public", "uploads", "expenses");
  await mkdir(dir, { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await writeFile(join(dir, safeName), buf);
  const path = `/uploads/expenses/${safeName}`;
  return NextResponse.json({ data: { path }, error: null });
}
