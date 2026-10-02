import { NextResponse } from "next/server";
import { getProfile } from "../../../../lib/auth";
import {
  getSalesReportByDealer,
  getSalesReportByRep,
  getSalesReportRegionPeriod,
  getSalesReportRegionTotals,
} from "../../../../lib/data";
import { buildReportWorkbook } from "../../../../lib/report-workbook";
import { ReportRangeError, describeReportRange, parseReportRange } from "../../../../lib/report-range";

// A real .xlsx of the /sales/reports figures, for the range on screen.
//
// The roles here are the roles the screen accepts, and the data comes from the
// same public.sales_report_* functions the page reads. Those are security_invoker,
// so the scoping is the database's decision and not this route's: a rep who asks
// for a spreadsheet gets their own dealers in it, exactly as they would on screen.
// There is no filter here to forget, and adding one would be the way to get this
// wrong. The workbook itself is built in lib/report-workbook.ts, which needs no
// session and so can be tested on its own.

const reportRoles = ["sales_rep", "sales_manager", "sales_director", "admin", "finance"];

// Never cached and never prerendered. The figures are the caller's own scope, so a
// cached copy of this response would be one role's data served to another.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const profile = await getProfile();
  if (!profile || !reportRoles.includes(profile.role)) {
    return NextResponse.json({ error: "Sales reporting access required." }, { status: 403 });
  }

  const url = new URL(request.url);

  // Parsed by the same module the screen uses, so a range the page accepted is a
  // range this route accepts, and one it refused is refused here too. The error is
  // returned rather than corrected: quietly exporting all time for a request that
  // asked for a month is the failure mode this guards against.
  let range;
  try {
    range = parseReportRange(url.searchParams);
  } catch (error) {
    // Only the parser's own rejection becomes a 400. Anything else is a bug and
    // must not be reported to the caller as a bad date.
    if (error instanceof ReportRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const [regionPeriod, regionTotals, byRep, byDealer] = await Promise.all([
    getSalesReportRegionPeriod(range),
    getSalesReportRegionTotals(range),
    getSalesReportByRep(range),
    getSalesReportByDealer(range),
  ]);

  const body = await buildReportWorkbook({
    range,
    role: profile.role,
    regionPeriod,
    regionTotals,
    byRep,
    byDealer,
  });

  // The filename carries the range, so a file found later says what it covers. A
  // range cannot contain a slash because it was validated as YYYY-MM-DD or null
  // before getting here, so this string is safe in a header.
  const stamp = range.from && range.to ? `${range.from}-to-${range.to}` : "all-time";

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Disposition": `attachment; filename="qsa-sales-report-${stamp}.xlsx"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Cache-Control": "no-store",
      // Echoed so a caller or a proxy log can tell which window a given response
      // was for, without opening the file.
      "X-QSA-Report-Range": describeReportRange(range),
      "Content-Length": String(body.byteLength),
    },
  });
}
