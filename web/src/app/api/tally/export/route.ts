import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getProfile, admitsRole } from "@/lib/auth";
import { createHash } from "crypto";

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function GET(request: Request) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!admitsRole(profile.role, ['admin','finance'] as any)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = profile.id;
  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const fromValue = url.searchParams.get("from");
  const toValue = url.searchParams.get("to");
  if ((fromValue && !isIsoDate(fromValue)) || (toValue && !isIsoDate(toValue))) {
    return NextResponse.json({ error: "Export dates must use YYYY-MM-DD." }, { status: 400 });
  }
  const periodStart = fromValue ?? monthStart;
  const periodEnd = toValue ?? today;
  if (periodEnd < periodStart) {
    return NextResponse.json({ error: "Export period is invalid." }, { status: 400 });
  }

  const invoices = await query<any>(
    `SELECT i.*, d.name AS dealer_name, d.email AS dealer_email FROM invoices i LEFT JOIN dealers d ON d.id=i.dealer_id WHERE i.invoice_date >= ? AND i.invoice_date <= ? ORDER BY i.invoice_number`,
    [periodStart, periodEnd],
  );
  const items = await query<any>(
    `SELECT oi.*, p.sku, p.name AS product_name FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id IN (SELECT order_id FROM invoices WHERE invoice_date >= ? AND invoice_date <= ?)`,
    [periodStart, periodEnd],
  );
  const itemsByOrder: Record<string, any[]> = {};
  for (const it of items) (itemsByOrder[it.order_id] ||= []).push(it);

  const payments = await query<any>(
    `SELECT p.*, d.name AS dealer_name, i.invoice_number FROM payments p LEFT JOIN dealers d ON d.id=p.dealer_id LEFT JOIN invoices i ON i.id=p.invoice_id WHERE p.payment_date >= ? AND p.payment_date <= ? ORDER BY p.payment_date`,
    [periodStart, periodEnd],
  );

  const headers = [
    "record_type", "document_number", "document_date", "dealer_name", "dealer_email",
    "sku", "product_name", "quantity", "unit_price", "line_total", "taxable_amount",
    "gst_amount", "invoice_total", "payment_amount", "payment_mode", "payment_reference",
  ];
  const rows: any[] = [];
  for (const inv of invoices) {
    const invItems = itemsByOrder[inv.order_id] || [];
    if (invItems.length === 0) {
      rows.push(["invoice", inv.invoice_number, inv.invoice_date, inv.dealer_name, inv.dealer_email, "", "", "", "", "", inv.taxable_amount, inv.gst_amount, inv.total_amount, "", "", ""]);
    } else {
      for (const it of invItems) {
        rows.push(["invoice", inv.invoice_number, inv.invoice_date, inv.dealer_name, inv.dealer_email, it.sku, it.product_name, it.quantity, it.unit_price, it.line_total, inv.taxable_amount, inv.gst_amount, inv.total_amount, "", "", ""]);
      }
    }
  }
  for (const p of payments) {
    rows.push(["payment", p.invoice_number ?? "", p.payment_date, p.dealer_name, "", "", "", "", "", "", "", "", "", p.amount, p.mode, p.reference]);
  }

  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const checksum = createHash("sha256").update(csv).digest("hex");

  // Audit record (matches handoff claim).
  try {
    await query(
      `INSERT INTO tally_exports (id, format, period_start, period_end, row_count, checksum, generated_by, created_at)
       VALUES (?,?,?,?,?,?,?,NOW())`,
      [crypto.randomUUID(), "csv", periodStart, periodEnd, rows.length, checksum, userId],
    );
  } catch {
    // Audit write must not block the export.
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tally-export-${periodStart}-to-${periodEnd}.csv"`,
      "X-Export-Checksum": checksum,
    },
  });
}