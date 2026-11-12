import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await query<any>("SELECT * FROM employees ORDER BY full_name");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ["admin", "production_manager", "inventory_manager", "finance"] as any))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await request.json();
  if (!b.full_name || !String(b.full_name).trim()) return NextResponse.json({ error: "Full name is required" }, { status: 400 });
  if (b.aadhaar_number && !/^[0-9]{12}$/.test(String(b.aadhaar_number).replace(/\s/g, ""))) return NextResponse.json({ error: "Aadhaar must be 12 digits" }, { status: 400 });
  if (b.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(b.pan_number).toUpperCase())) return NextResponse.json({ error: "Invalid PAN" }, { status: 400 });

  const id = crypto.randomUUID();
  await query(
    `INSERT INTO employees (id,user_id,full_name,department,designation,join_date,salary,status,aadhaar_number,pan_number,bank_account_number,bank_ifsc,bank_name,address_line1,address_line2,city,state,postal_code,photo_path,employment_type,probation_months,probation_end_date,leave_quota,leave_quota_after_probation,notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, b.user_id || null, String(b.full_name).trim(), b.department || null, b.designation || null, b.join_date || null, b.salary ?? null, b.status || "active",
      b.aadhaar_number ? String(b.aadhaar_number).replace(/\s/g, "") : null,
      b.pan_number ? String(b.pan_number).toUpperCase() : null,
      b.bank_account_number || null, b.bank_ifsc || null, b.bank_name || null,
      b.address_line1 || null, b.address_line2 || null, b.city || null, b.state || null, b.postal_code || null,
      b.photo_path || null, b.employment_type || "permanent",
      b.probation_months ?? null, b.probation_end_date || null,
      b.leave_quota ?? 0, b.leave_quota_after_probation ?? null, b.notes || null,
    ],
  );
  return NextResponse.json({ data: { id }, error: null });
}
