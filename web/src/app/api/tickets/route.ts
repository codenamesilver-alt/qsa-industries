import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";

const VALID_STATUSES = ["open", "pending_approval", "approved", "denied", "in_progress", "resolved", "cancelled", "closed"];

export async function GET(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const rows = status
    ? await query<any>("SELECT * FROM tickets WHERE status=? ORDER BY created_at DESC", [status])
    : await query<any>("SELECT * FROM tickets ORDER BY created_at DESC");
  return NextResponse.json({ data: rows, error: null });
}

export async function POST(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json();
  const action = b.action || "create";

  if (action === "create") {
    if (!b.subject || !String(b.subject).trim()) return NextResponse.json({ error: "Subject is required" }, { status: 400 });
    if (!b.department) return NextResponse.json({ error: "Department is required" }, { status: 400 });
    // auto-generate ticket number
    const cnt = await queryOne<any>("SELECT COUNT(*) AS c FROM tickets");
    const num = `TKT-${String((cnt?.c ?? 0) + 1).padStart(4, "0")}`;
    // resolve approver = raised_by's reporting manager (or provided)
    let approverId = b.approver_id || null;
    if (!approverId && b.raised_by) {
      const u = await queryOne<any>("SELECT reports_to_id FROM users WHERE id=?", [b.raised_by]);
      approverId = u?.reports_to_id || null;
    }
    if (!approverId) approverId = (await queryOne<any>("SELECT id FROM users WHERE role='admin' LIMIT 1"))?.id || null;
    const id = crypto.randomUUID();
    const status = approverId ? "pending_approval" : "open";
    await query(
      `INSERT INTO tickets (id, ticket_number, subject, description, dealer_id, raised_by, assigned_to, priority, status, department, approver_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
      [id, num, String(b.subject).trim(), b.description || null, b.dealer_id || null, b.raised_by || profile.id, b.assigned_to || null, b.priority || "medium", status, b.department, approverId],
    );
    return NextResponse.json({ data: { id, ticket_number: num, status }, error: null });
  }

  if (!b.ticket_id) return NextResponse.json({ error: "ticket_id required" }, { status: 400 });
  const ticket = await queryOne<any>("SELECT * FROM tickets WHERE id=?", [b.ticket_id]);
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });

  const isAdmin = profile.role === "admin";
  const isApprover = ticket.approver_id === profile.id;

  if (action === "approve") {
    if (!isAdmin && !isApprover) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (ticket.status !== "pending_approval") return NextResponse.json({ error: "Ticket not pending approval" }, { status: 400 });
    await query("UPDATE tickets SET status='approved', approved_at=NOW(), approved_by=? WHERE id=?", [profile.id, b.ticket_id]);
    return NextResponse.json({ data: null, error: null });
  }
  if (action === "deny") {
    if (!isAdmin && !isApprover) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (ticket.status !== "pending_approval") return NextResponse.json({ error: "Ticket not pending approval" }, { status: 400 });
    if (!b.reason) return NextResponse.json({ error: "Denial reason required" }, { status: 400 });
    await query("UPDATE tickets SET status='denied', denied_at=NOW(), denied_by=?, denied_reason=? WHERE id=?", [profile.id, b.reason, b.ticket_id]);
    return NextResponse.json({ data: null, error: null });
  }
  if (action === "cancel") {
    if (!isAdmin && ticket.raised_by !== profile.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (["resolved", "closed", "cancelled"].includes(ticket.status)) return NextResponse.json({ error: "Cannot cancel" }, { status: 400 });
    await query("UPDATE tickets SET status='cancelled', cancelled_at=NOW(), cancelled_by=?, cancelled_reason=? WHERE id=?", [profile.id, b.reason || null, b.ticket_id]);
    return NextResponse.json({ data: null, error: null });
  }
  if (action === "start") {
    if (!["approved", "open"].includes(ticket.status)) return NextResponse.json({ error: "Cannot start" }, { status: 400 });
    await query("UPDATE tickets SET status='in_progress' WHERE id=?", [b.ticket_id]);
    return NextResponse.json({ data: null, error: null });
  }
  if (action === "resolve") {
    await query("UPDATE tickets SET status='resolved' WHERE id=?", [b.ticket_id]);
    return NextResponse.json({ data: null, error: null });
  }
  if (action === "close") {
    await query("UPDATE tickets SET status='closed' WHERE id=?", [b.ticket_id]);
    return NextResponse.json({ data: null, error: null });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
