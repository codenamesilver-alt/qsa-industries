import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  if (!b.p_name || !String(b.p_name).trim()) return NextResponse.json({ error: "Dealer name is required" }, { status: 400 });
  if (!b.p_region || !String(b.p_region).trim()) return NextResponse.json({ error: "Region is required" }, { status: 400 });
  const cl = Number(b.p_credit_limit);
  if (b.p_credit_limit != null && (!Number.isFinite(cl) || cl < 0)) return NextResponse.json({ error: "Credit limit must be 0 or more" }, { status: 400 });
  if (b.p_dealer_id) {
    await query(
      `UPDATE dealers SET name=?,contact_person=?,phone=?,email=?,address_line1=?,address_line2=?,city=?,state=?,postal_code=?,credit_limit=?,credit_limit_override=?,status=?,region=?,sales_rep_id=? WHERE id=?`,
      [b.p_name,b.p_contact_person,b.p_phone,b.p_email,b.p_address_line1,b.p_address_line2,b.p_city,b.p_state,b.p_postal_code,b.p_credit_limit,b.p_credit_limit_override,b.p_status,b.p_region,b.p_sales_rep_id,b.p_dealer_id],
    );
  } else {
    const id = crypto.randomUUID();
    await query(
      `INSERT INTO dealers (id,name,contact_person,phone,email,address_line1,address_line2,city,state,postal_code,credit_limit,credit_limit_override,status,region,sales_rep_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id,b.p_name,b.p_contact_person,b.p_phone,b.p_email,b.p_address_line1,b.p_address_line2,b.p_city,b.p_state,b.p_postal_code,b.p_credit_limit,b.p_credit_limit_override,b.p_status,b.p_region,b.p_sales_rep_id],
    );
  }
  return NextResponse.json({ data: null, error: null });
}