import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const b = await request.json();
  const action = b.action;
  if (action === "start") {
    const dealerId = crypto.randomUUID();
    await query(
      `INSERT INTO dealers (id,name,contact_person,phone,email,address_line1,address_line2,city,state,postal_code,credit_limit,status,region,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?, 'inactive', ?, NOW())`,
      [dealerId, b.p_name, b.p_contact_person || null, b.p_phone || null, b.p_email || null, b.p_address_line1 || null, b.p_address_line2 || null, b.p_city || null, b.p_state || null, b.p_postal_code || null, 0, b.p_region],
    );
    await query(
      `INSERT INTO dealer_onboardings (dealer_id,gstin,pan,credit_limit_requested,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,NOW(),NOW())`,
      [dealerId, b.p_gstin || null, b.p_pan || null, b.p_credit_limit_requested, userId],
    );
    return NextResponse.json({ data: { id: dealerId }, error: null });
  }
  if (action === "edit") {
    await query(
      "UPDATE dealer_onboardings SET credit_limit_requested=? WHERE dealer_id=?",
      [b.p_credit_limit_requested, b.p_dealer_id],
    );
    return NextResponse.json({ data: null, error: null });
  }
  if (action === "credit_decision") {
    await query(
      "UPDATE dealer_onboardings SET credit_approved=?, credit_decided_at=NOW(), credit_decided_by=?, credit_decision_note=? WHERE dealer_id=?",
      [b.p_credit_approved ? 1 : 0, userId, b.p_note, b.p_dealer_id],
    );
    if (b.p_credit_approved) {
      await query("UPDATE dealers SET credit_limit=? WHERE id=?", [b.p_credit_limit, b.p_dealer_id]);
    }
    return NextResponse.json({ data: null, error: null });
  }
  if (action === "map_rep") {
    await query("UPDATE dealers SET sales_rep_id=? WHERE id=?", [b.p_sales_rep_id, b.p_dealer_id]);
    return NextResponse.json({ data: null, error: null });
  }
  if (action === "activate") {
    await query("UPDATE dealers SET status='active' WHERE id=?", [b.p_dealer_id]);
    await query("UPDATE dealer_onboardings SET activated_at=NOW(), activated_by=? WHERE dealer_id=?", [userId, b.p_dealer_id]);
    return NextResponse.json({ data: null, error: null });
  }
  if (action === "decline") {
    await query("UPDATE dealer_onboardings SET declined_at=NOW(), declined_by=?, decline_reason=? WHERE dealer_id=?", [userId, b.p_decline_reason, b.p_dealer_id]);
    return NextResponse.json({ data: null, error: null });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}