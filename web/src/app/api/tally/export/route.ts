import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getProfile } from "../../../../lib/auth";
import { businessDate } from "../../../../lib/format";
import { createClient } from "../../../../lib/supabase/server";

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const normalized = text.trimStart();
  const formulaLike =
    /^[=+@]/.test(normalized) ||
    (normalized.startsWith("-") && !/^-\d+(?:\.\d+)?$/.test(normalized));
  const safeText = formulaLike ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function isIsoDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  const profile = await getProfile();
  if (!profile || !["admin", "finance"].includes(profile.role)) {
    return NextResponse.json({ error: "Finance access required." }, { status: 403 });
  }

  const url = new URL(request.url);
  const today = businessDate();
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

  const supabase = await createClient();
  const pageSize = 1000;
  const invoiceRows: Array<Record<string, unknown>> = [];
  const paymentRows: Array<Record<string, unknown>> = [];

  for (let offset = 0; ; offset += pageSize) {
    const page = await supabase
      .from("tally_invoice_lines")
      .select("*")
      .gte("invoice_date", periodStart)
      .lte("invoice_date", periodEnd)
      .order("invoice_number")
      .order("line_id")
      .range(offset, offset + pageSize - 1);
    if (page.error) {
      return NextResponse.json({ error: page.error.message }, { status: 500 });
    }
    invoiceRows.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < pageSize) break;
  }

  for (let offset = 0; ; offset += pageSize) {
    const page = await supabase
      .from("tally_payment_lines")
      .select("*")
      .gte("export_date", periodStart)
      .lte("export_date", periodEnd)
      .order("export_date")
      .order("line_id")
      .range(offset, offset + pageSize - 1);
    if (page.error) {
      return NextResponse.json({ error: page.error.message }, { status: 500 });
    }
    paymentRows.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < pageSize) break;
  }

  const headers = [
    "record_type",
    "document_number",
    "document_date",
    "dealer_name",
    "dealer_email",
    "sku",
    "product_name",
    "quantity",
    "unit_price",
    "line_total",
    "taxable_amount",
    "gst_amount",
    "invoice_total",
    "payment_amount",
    "payment_mode",
    "payment_reference",
  ];
  const rows = [
    ...invoiceRows.map((row) => [
      "invoice",
      row.invoice_number,
      row.invoice_date,
      row.dealer_name,
      row.dealer_email,
      row.sku,
      row.product_name,
      row.quantity,
      row.unit_price,
      row.line_total,
      row.taxable_amount,
      row.gst_amount,
      row.total_amount,
      "",
      "",
      "",
    ]),
    ...paymentRows.map((row) => [
      "payment",
      row.invoice_number ?? "",
      row.export_date,
      row.dealer_name,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      row.amount,
      row.mode,
      row.reference,
    ]),
  ];
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const checksum = createHash("sha256").update(csv).digest("hex");
  const exportResult = await supabase.rpc("record_tally_export", {
    export_format: "csv",
    period_start_value: periodStart,
    period_end_value: periodEnd,
    export_row_count: rows.length,
    export_storage_path: null,
    export_checksum: checksum,
  });

  if (exportResult.error) {
    return NextResponse.json({ error: exportResult.error.message }, { status: 500 });
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Disposition": `attachment; filename="qsa-tally-${periodStart}-to-${periodEnd}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "X-QSA-Export-Checksum": checksum,
    },
  });
}
