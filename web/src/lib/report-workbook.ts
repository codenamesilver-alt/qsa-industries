import ExcelJS from "exceljs";
import { businessDate } from "./format";
import { describeReportRange, type ReportRange } from "./report-range";
import type {
  SalesByDealerRow,
  SalesByRegionPeriodRow,
  SalesByRegionTotalsRow,
  SalesByRepRow,
} from "./data";

// Builds the sales report workbook. Pure with respect to everything except the
// clock, so it can be exercised without a session: the figures go in, a real .xlsx
// comes out.
//
// Money is written as numbers carrying a number format, never as pre-formatted
// strings. A spreadsheet whose money cells are text cannot be summed, sorted by
// value, or pivoted, which defeats the reason for asking for a spreadsheet at all.
//
// On spreadsheet injection: /api/tally/export quotes cells because CSV is
// untyped, so a value beginning = + @ or - is a formula to Excel. A .xlsx is
// typed, and exceljs writes a string cell as a shared string with no formula part,
// so a dealer named "=cmd|..." arrives as text and is never evaluated. That was
// checked against the writer rather than assumed, and it is why there is no
// equivalent of csvCell here. The protection is in the file format, not in this
// code, which is the thing to remember before swapping the writer out.

const RUPEE = "#,##0.00";
const COUNT = "#,##0";

// The four inputs are the existing view row types, not new ones: the functions
// return the same columns as the views they mirror, and stage20 asserts that. One
// set of types means a column renamed on a view cannot leave this file compiling
// against a shape the data no longer has.
export interface ReportWorkbookInput {
  range: ReportRange;
  /** The requesting user's role, recorded on the Summary sheet as the scope. */
  role: string;
  regionPeriod: SalesByRegionPeriodRow[];
  regionTotals: SalesByRegionTotalsRow[];
  byRep: SalesByRepRow[];
  byDealer: SalesByDealerRow[];
}

// Postgres numeric arrives as a string over PostgREST, so every figure is coerced
// through here rather than trusted to be a number. A non-numeric value becomes 0
// rather than NaN, because NaN in a cell renders as a silent blank and a blank
// money cell reads as "no money", which is a different and wrong claim.
function num(value: number | string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function buildReportWorkbook(input: ReportWorkbookInput): Promise<Buffer> {
  const { range, role, regionPeriod, regionTotals, byRep, byDealer } = input;

  const realizedTotal = regionTotals.reduce((sum, row) => sum + num(row.realized_amount), 0);
  const pipelineTotal = regionTotals.reduce((sum, row) => sum + num(row.pipeline_amount), 0);
  const outstandingTotal = byDealer.reduce((sum, row) => sum + num(row.outstanding_amount), 0);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QSA Industries";
  workbook.created = new Date();

  const headerStyle = {
    bold: true,
    fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF1F5EC" } },
  };

  // ---------------------------------------------------------------------------
  // Summary. Carries the range, the scope, and the figures that do NOT follow the
  // range, so a file that reaches someone three weeks later can still be read
  // without the screen it came from.
  //
  // Amounts are attached to the row addRow hands back rather than to a literal
  // "B7". A hardcoded cell address survives exactly until someone inserts a line
  // above it, and then the number format lands on the wrong figure with nothing
  // to show for it.
  // ---------------------------------------------------------------------------
  const summary = workbook.addWorksheet("Summary");
  summary.columns = [{ width: 30 }, { width: 22 }, { width: 64 }];

  summary.addRow(["QSA Industries", "Sales report", ""]).font = { bold: true };
  summary.addRow(["Range", describeReportRange(range), "Order date is Asia/Kolkata, both ends included"]);
  summary.addRow(["Scope", role, "Rows are limited to what this role may see"]);
  summary.addRow(["Generated", businessDate(), "Same figures as the /sales/reports screen"]);
  summary.addRow(["", "", ""]);
  summary.addRow(["Measure", "Amount", "Note"]).font = headerStyle;

  summary
    .addRow(["Realized", realizedTotal, "Approved, dispatched or invoiced, within the range"])
    .getCell(2).numFmt = RUPEE;
  summary
    .addRow(["Pipeline", pipelineTotal, "Pending or director-pending, within the range"])
    .getCell(2).numFmt = RUPEE;
  summary
    .addRow([
      "Outstanding",
      outstandingTotal,
      "Current balance on raised invoices. NOT limited to the range: this is money still owed, not money that moved in the window.",
    ])
    .getCell(2).numFmt = RUPEE;
  summary.addRow(["", "", ""]);
  summary.addRow([
    "",
    "",
    "Region, rep and dealer figures come from the same security_invoker functions as the screen.",
  ]);

  // The outstanding note is a sentence in a narrow column, and an unwrapped
  // sentence in a spreadsheet is three lines of clipped text.
  summary.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });

  // ---------------------------------------------------------------------------
  // Regions
  // ---------------------------------------------------------------------------
  const regions = workbook.addWorksheet("Regions");
  regions.columns = [
    { header: "Region", key: "region", width: 22 },
    { header: "Dealers with orders", key: "dealers", width: 20 },
    { header: "Realized orders", key: "realizedOrders", width: 16 },
    { header: "Realized", key: "realized", width: 16 },
    { header: "Pipeline orders", key: "pipelineOrders", width: 16 },
    { header: "Pipeline", key: "pipeline", width: 16 },
  ];
  regions.getRow(1).font = headerStyle;
  for (const row of regionTotals) {
    regions.addRow({
      region: row.region,
      dealers: num(row.dealer_count),
      realizedOrders: num(row.realized_orders),
      realized: num(row.realized_amount),
      pipelineOrders: num(row.pipeline_orders),
      pipeline: num(row.pipeline_amount),
    });
  }
  for (const key of ["dealers", "realizedOrders", "pipelineOrders"]) {
    regions.getColumn(key).numFmt = COUNT;
  }
  for (const key of ["realized", "pipeline"]) {
    regions.getColumn(key).numFmt = RUPEE;
  }

  // ---------------------------------------------------------------------------
  // Reporting lines
  // ---------------------------------------------------------------------------
  const lines = workbook.addWorksheet("Reporting lines");
  lines.columns = [
    { header: "Rep", key: "rep", width: 26 },
    { header: "Manager", key: "manager", width: 26 },
    { header: "Region", key: "region", width: 20 },
    { header: "Dealers with orders", key: "dealers", width: 20 },
    { header: "Realized orders", key: "realizedOrders", width: 16 },
    { header: "Realized", key: "realized", width: 16 },
    { header: "Pipeline orders", key: "pipelineOrders", width: 16 },
    { header: "Pipeline", key: "pipeline", width: 16 },
  ];
  lines.getRow(1).font = headerStyle;
  for (const row of byRep) {
    lines.addRow({
      rep: row.rep_name,
      manager: row.manager_name,
      region: row.region,
      dealers: num(row.dealer_count),
      realizedOrders: num(row.realized_orders),
      realized: num(row.realized_amount),
      pipelineOrders: num(row.pipeline_orders),
      pipeline: num(row.pipeline_amount),
    });
  }
  for (const key of ["dealers", "realizedOrders", "pipelineOrders"]) {
    lines.getColumn(key).numFmt = COUNT;
  }
  for (const key of ["realized", "pipeline"]) {
    lines.getColumn(key).numFmt = RUPEE;
  }

  // ---------------------------------------------------------------------------
  // Dealer book
  // ---------------------------------------------------------------------------
  const dealers = workbook.addWorksheet("Dealer book");
  dealers.columns = [
    { header: "Dealer", key: "dealer", width: 30 },
    { header: "Region", key: "region", width: 20 },
    { header: "State", key: "state", width: 16 },
    { header: "Status", key: "status", width: 12 },
    { header: "Realized orders", key: "realizedOrders", width: 16 },
    { header: "Realized", key: "realized", width: 16 },
    { header: "Pipeline orders", key: "pipelineOrders", width: 16 },
    { header: "Pipeline", key: "pipeline", width: 16 },
    { header: "Invoiced", key: "invoiced", width: 16 },
    { header: "Open invoices", key: "openInvoices", width: 14 },
    // Named "current" in the heading because this column is not bounded by the
    // range, which the Summary sheet also says. Labelling it here means the
    // claim survives being copied out of this file on its own.
    { header: "Outstanding (current balance)", key: "outstanding", width: 24 },
  ];
  dealers.getRow(1).font = headerStyle;
  for (const row of byDealer) {
    dealers.addRow({
      dealer: row.dealer_name,
      region: row.region,
      state: row.state ?? "",
      status: row.status,
      realizedOrders: num(row.realized_orders),
      realized: num(row.realized_amount),
      pipelineOrders: num(row.pipeline_orders),
      pipeline: num(row.pipeline_amount),
      invoiced: num(row.invoiced_amount),
      openInvoices: num(row.open_invoices),
      outstanding: num(row.outstanding_amount),
    });
  }
  for (const key of ["realizedOrders", "pipelineOrders", "openInvoices"]) {
    dealers.getColumn(key).numFmt = COUNT;
  }
  for (const key of ["realized", "pipeline", "invoiced", "outstanding"]) {
    dealers.getColumn(key).numFmt = RUPEE;
  }

  // ---------------------------------------------------------------------------
  // Monthly trend
  // ---------------------------------------------------------------------------
  const trend = workbook.addWorksheet("Monthly trend");
  trend.columns = [
    { header: "Month", key: "period", width: 14 },
    { header: "Region", key: "region", width: 22 },
    { header: "Dealers selling", key: "dealersSelling", width: 16 },
    { header: "Realized orders", key: "realizedOrders", width: 16 },
    { header: "Realized", key: "realized", width: 16 },
    { header: "Pipeline orders", key: "pipelineOrders", width: 16 },
    { header: "Pipeline", key: "pipeline", width: 16 },
    { header: "Rejected orders", key: "rejectedOrders", width: 16 },
    { header: "Rejected", key: "rejected", width: 16 },
  ];
  trend.getRow(1).font = headerStyle;
  for (const row of regionPeriod) {
    trend.addRow({
      period: row.period,
      region: row.region,
      dealersSelling: num(row.dealers_selling),
      realizedOrders: num(row.realized_orders),
      realized: num(row.realized_amount),
      pipelineOrders: num(row.pipeline_orders),
      pipeline: num(row.pipeline_amount),
      rejectedOrders: num(row.rejected_orders),
      rejected: num(row.rejected_amount),
    });
  }
  for (const key of ["dealersSelling", "realizedOrders", "pipelineOrders", "rejectedOrders"]) {
    trend.getColumn(key).numFmt = COUNT;
  }
  for (const key of ["realized", "pipeline", "rejected"]) {
    trend.getColumn(key).numFmt = RUPEE;
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
