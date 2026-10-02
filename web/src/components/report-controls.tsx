import { PrintButton } from "./print-button";
import { reportRangeQuery, type ReportRange } from "../lib/report-range";

// The report header: which period these figures cover, and the ways to take them
// away.
//
// Deliberately a plain GET form rather than a client component with state. The
// range ends up in the query string, which means the screen is bookmarkable and
// shareable, the browser back button behaves, the page works with JavaScript
// disabled, and there is no state to fall out of sync with the URL. The
// consequence worth stating: changing the range is a navigation, not an instant
// toggle, so it costs a server render. For a report that aggregates the whole
// order book that is the right trade, and it is the same trade every other
// filtered screen in this system makes.
export function ReportControls({
  downloadHref,
  range,
}: {
  downloadHref: string;
  range: ReportRange;
}) {
  return (
    <section
      // Hidden when printing. The window a reader is looking at is printed; the
      // controls that chose it are not. Kept out of print with one class rather
      // than a whole print stylesheet.
      className="print:hidden mt-6 rounded-2xl border border-[#e3e9dd] bg-[#f7faf4] p-4"
    >
      <div className="flex flex-wrap items-end gap-4">
        <form action="/sales/reports" className="flex flex-wrap items-end gap-3" method="get">
          <div>
            <label
              className="block text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[#819083]"
              htmlFor="report-from"
            >
              From
            </label>
            <input
              className="mt-1 rounded-lg border border-[#d6e1ce] bg-white px-3 py-2 text-sm text-[#15221b]"
              id="report-from"
              max={range.to ?? undefined}
              name="from"
              type="date"
              defaultValue={range.from ?? ""}
            />
          </div>
          <div>
            <label
              className="block text-[0.68rem] font-bold uppercase tracking-[0.16em] text-[#819083]"
              htmlFor="report-to"
            >
              To
            </label>
            <input
              className="mt-1 rounded-lg border border-[#d6e1ce] bg-white px-3 py-2 text-sm text-[#15221b]"
              id="report-to"
              min={range.from ?? undefined}
              name="to"
              type="date"
              defaultValue={range.to ?? ""}
            />
          </div>
          <button
            className="rounded-full bg-[#15221b] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#2b3d31] disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
          >
            Apply range
          </button>
          {/* Clears to the all-time report, which is what the screen showed before
              a range existed and what an empty pair of inputs means. */}
          <a
            className="rounded-full border border-[#d6e1ce] bg-white px-4 py-2 text-xs font-bold text-[#4f6254] transition hover:border-[#9db56a] hover:text-[#15221b]"
            href="/sales/reports"
          >
            All time
          </a>
        </form>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {/* The download carries the same from and to as the screen, built from the
              same parser, so the file always matches the page it was taken from. */}
          <a
            className="rounded-full border border-[#9db56a] bg-white px-4 py-2 text-xs font-bold text-[#4e741d] transition hover:bg-[#eef4e6]"
            download
            href={downloadHref}
          >
            Download Excel
          </a>
          <PrintButton />
        </div>
      </div>

      <p className="mt-3 text-xs text-[#819083]">
        Order date is Asia/Kolkata, and both ends of the range are included. Leave either
        box empty for an open-ended range.
      </p>
    </section>
  );
}

// Where the "download this as Excel" link points, given the range on screen.
export function reportExportHref(range: ReportRange): string {
  return `/api/reports/export${reportRangeQuery(range)}`;
}
