// Exercises the real buildReportWorkbook against fabricated rows, with no session
// and no database. Run with `npm run test:workbook`.
//
// This exists because the workbook builder is the one part of the export that
// pgTAP and `next build` cannot reach: the SQL is tested, the route compiles, and
// neither proves that a rupee cell holds a number rather than a string, that the
// outstanding column is still labelled as a current balance, or that a dealer name
// beginning with "=" is not a live formula. All three fail silently otherwise.
//
// Fix: if a check here fails, the sheet building in src/lib/report-workbook.ts is
// wrong, not the expectations below, unless the expectations are what changed.
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { buildReportWorkbook } from "../src/lib/report-workbook";

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

async function main() {
const range = { from: "2026-08-01", to: "2026-08-31" } as const;

const buffer = await buildReportWorkbook({
  range,
  role: "admin",
  regionTotals: [
    // numeric-as-string, which is how PostgREST returns Postgres numeric
    { region: "West", dealer_count: "3", realized_orders: "2", realized_amount: "1500.50", pipeline_orders: "1", pipeline_amount: "400.00" },
    { region: "South", dealer_count: "1", realized_orders: "0", realized_amount: "0", pipeline_orders: "1", pipeline_amount: "250.25" },
  ],
  byRep: [
    { rep_id: "r-1", rep_name: "Asha", manager_id: "m-1", manager_name: "Manager One", region: "West", dealer_count: "3", realized_orders: "2", realized_amount: "1500.50", pipeline_orders: "1", pipeline_amount: "400.00" },
  ],
  byDealer: [
    // a dealer name that a CSV export would have to guard, and a region that is
    // absent rather than null, to check the fallback did not become "null"
    { dealer_id: "d-1", dealer_name: "=cmd|' /C calc'!A0", region: "West", state: "Maharashtra", status: "active", realized_orders: "2", realized_amount: "1500.50", pipeline_orders: "1", pipeline_amount: "400.00", invoiced_amount: "900.00", open_invoices: "1", outstanding_amount: "600.00", credit_limit: "50000.00" },
    { dealer_id: "d-2", dealer_name: "Empty Co", region: "Unassigned", state: null, status: "prospect", realized_orders: "0", realized_amount: "0", pipeline_orders: "0", pipeline_amount: "0", invoiced_amount: "0", open_invoices: "0", outstanding_amount: "0", credit_limit: "0" },
  ],
  regionPeriod: [
    { period: "2026-08-01", region: "West", dealers_selling: "2", realized_orders: "2", realized_amount: "1500.50", pipeline_orders: "1", pipeline_amount: "400.00", rejected_orders: "1", rejected_amount: "120.00" },
  ],
});

check("produces a non-empty buffer", buffer.length > 1000, `${buffer.length} bytes`);

// A .xlsx is a zip, so the magic bytes prove the type before exceljs reads it back.
check("is a zip container (PK magic)", buffer[0] === 0x50 && buffer[1] === 0x4b);

// Read the workbook back the way a recipient would: from a file on disk, via
// readFile rather than load. exceljs depends on the legacy `buffer` polyfill, whose
// Buffer type is not the same type as Node's, so load(buffer) needs a cast that
// says nothing about whether the file is any good. readFile also checks the thing
// that actually matters, that this is a valid .xlsx on disk and not just a
// buffer-shaped object in memory.
const outPath = join(mkdtempSync(join(tmpdir(), "qsa-workbook-")), "report.xlsx");
writeFileSync(outPath, buffer);

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(outPath);

const names = wb.worksheets.map((ws) => ws.name);
check(
  "has the five expected sheets",
  JSON.stringify(names) === JSON.stringify(["Summary", "Regions", "Reporting lines", "Dealer book", "Monthly trend"]),
  names.join(", "),
);

const summary = wb.getWorksheet("Summary")!;
// The totals: 1500.50 + 0 realized, 400 + 250.25 pipeline, 600 + 0 outstanding.
const realizedCell = summary.getRow(7).getCell(2);
const pipelineCell = summary.getRow(8).getCell(2);
const outstandingCell = summary.getRow(9).getCell(2);
check("summary realized total is 1500.5", realizedCell.value === 1500.5, `got ${JSON.stringify(realizedCell.value)}`);
check("summary pipeline total is 650.25", pipelineCell.value === 650.25, `got ${JSON.stringify(pipelineCell.value)}`);
check("summary outstanding total is 600", outstandingCell.value === 600, `got ${JSON.stringify(outstandingCell.value)}`);

// The reason for not hardcoding B7: the three amounts must each carry the money
// format, and if a row were inserted above them the addresses would slide.
for (const [name, cell] of [["realized", realizedCell], ["pipeline", pipelineCell], ["outstanding", outstandingCell]] as const) {
  check(`summary ${name} has a number format`, cell.numFmt === "#,##0.00", `numFmt=${cell.numFmt}`);
}
check("summary records the range", summary.getRow(2).getCell(2).value === "2026-08-01 to 2026-08-31", String(summary.getRow(2).getCell(2).value));
check("summary records the role", summary.getRow(3).getCell(2).value === "admin");

// Money as text would be the quiet failure: it renders identically in Excel and
// cannot be summed.
const regions = wb.getWorksheet("Regions")!;
const realizedValue = regions.getRow(2).getCell(4).value;
check("region money is a number, not a string", typeof realizedValue === "number", `type ${typeof realizedValue}`);
check("region money coerced from numeric string", realizedValue === 1500.5, `got ${JSON.stringify(realizedValue)}`);
check("region count is a number", typeof regions.getRow(2).getCell(2).value === "number");
check("region money formatted", regions.getRow(2).getCell(4).numFmt === "#,##0.00", `numFmt=${regions.getRow(2).getCell(4).numFmt}`);

const book = wb.getWorksheet("Dealer book")!;
const headerNames = (book.getRow(1).values as unknown[]).slice(1).map(String);
check("dealer book has 11 columns", headerNames.length === 11, String(headerNames.length));
check(
  "outstanding column is labelled as a current balance",
  headerNames[10] === "Outstanding (current balance)",
  headerNames[10],
);

// The injection case. A string cell with no formula part is inert in Excel.
const dealerNameCell = book.getRow(2).getCell(1);
check("dealer name preserved verbatim", dealerNameCell.value === "=cmd|' /C calc'!A0", String(dealerNameCell.value));
check("dealer name is not a formula", dealerNameCell.formula === undefined, `formula=${dealerNameCell.formula}`);
check("dealer name is a string cell", dealerNameCell.type === ExcelJS.ValueType.String);

// A null state must read as blank, not as the text "null".
check("null state writes as empty string", book.getRow(3).getCell(3).value === "", `got ${JSON.stringify(book.getRow(3).getCell(3).value)}`);
check("dealer with no orders is still listed", book.getRow(3).getCell(1).value === "Empty Co");

const trend = wb.getWorksheet("Monthly trend")!;
check("trend month written", trend.getRow(2).getCell(1).value === "2026-08-01", String(trend.getRow(2).getCell(1).value));
check("trend rejected value present", trend.getRow(2).getCell(9).value === 120, `got ${JSON.stringify(trend.getRow(2).getCell(9).value)}`);
check("trend has 9 columns", (trend.getRow(1).values as unknown[]).length - 1 === 9);

console.log("");
if (failures.length) {
  console.log(`${failures.length} FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("all workbook checks passed");
}

main().catch((error) => {
  console.log("HARNESS ERROR:", error);
  process.exit(1);
});
