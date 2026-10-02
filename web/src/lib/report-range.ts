// One definition of "which period is this report", shared by the /sales/reports
// screen and the /api/reports/export route.
//
// These two have to agree exactly. If the screen read ?from=2026-08-01 and the
// download read something else, the file would disagree with the page it was
// taken from, and a user who reconciled a number against the screen would have no
// way to tell which one was wrong. So both parse through here rather than each
// reading searchParams themselves.
//
// A null bound is unbounded, which matches public.sales_report_* : calling those
// with (null, null) returns the all-time report. That is why an absent from or to
// is not an error and not a default window. /sales/reports has always shown all
// time, and silently replacing that with "this month" would change what an
// existing link means.

export type ReportRange = {
  from: string | null;
  to: string | null;
};

export const UNBOUNDED_REPORT_RANGE: ReportRange = { from: null, to: null };

// A plain YYYY-MM-DD. Deliberately stricter than Date.parse: "March 2026",
// "2026-3-1" and "03/01/2026" are all things a user can type, and a report whose
// window depends on which of them the engine happened to accept is not a report
// anyone can reconcile.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ReportRangeError extends Error {}

// Parses one bound. Returns null for absent, empty or whitespace, which is how a
// cleared date input arrives. Throws for anything present that is not a real date,
// rather than silently dropping it, because a typo that quietly widened the report
// to all time is the worst outcome available: the numbers would look right.
function parseBound(
  raw: string | string[] | null | undefined,
  label: "from" | "to",
): string | null {
  if (raw == null) return null;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;

  if (!ISO_DATE.test(trimmed)) {
    throw new ReportRangeError(`${label} must be a date as YYYY-MM-DD, got ${trimmed}`);
  }

  // ISO_DATE already fixes the shape, so this is only rejecting impossible days
  // such as 2026-02-31, which Date would roll forward into March and quietly
  // report a different window than the one displayed.
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new ReportRangeError(`${label} is not a real date: ${trimmed}`);
  }

  return trimmed;
}

export function parseReportRange(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): ReportRange {
  const read = (key: string) =>
    params instanceof URLSearchParams ? params.get(key) : params[key];

  const from = parseBound(read("from"), "from");
  const to = parseBound(read("to"), "to");

  if (from !== null && to !== null && from > to) {
    throw new ReportRangeError(`from ${from} is after to ${to}`);
  }

  return { from, to };
}

export function isBounded(range: ReportRange): boolean {
  return range.from !== null || range.to !== null;
}

export function sameRange(a: ReportRange, b: ReportRange): boolean {
  return a.from === b.from && a.to === b.to;
}

// The label shown on the screen and written into the spreadsheet. Both surfaces
// say the same words, so a printed page and a downloaded file are traceable to
// each other.
export function describeReportRange(range: ReportRange): string {
  if (range.from === null && range.to === null) return "All time";
  if (range.from === null) return `Up to ${range.to}`;
  if (range.to === null) return `From ${range.from}`;
  if (range.from === range.to) return range.from;
  return `${range.from} to ${range.to}`;
}

// The query string for a link, so a shared or bookmarked report keeps its window.
export function reportRangeQuery(range: ReportRange): string {
  const params = new URLSearchParams();
  if (range.from !== null) params.set("from", range.from);
  if (range.to !== null) params.set("to", range.to);
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}
