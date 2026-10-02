"use client";

// PDF export is the browser's own print dialog, saved to PDF. There is no
// /api/reports/pdf route, because a server-rendered PDF and the screen would be
// two renderings of one report with no guarantee they agree. Printing keeps a
// single code path: what is printed is exactly what was on screen, at the range
// that was on screen.
//
// The cost is that the result is a print of a screen, not a designed document.
// A print stylesheet in web/src/app/globals.css removes the navigation, the
// controls and the page chrome so the tables and figures are what comes out.
export function PrintButton({ label = "Print / PDF" }: { label?: string }) {
  function handlePrint() {
    window.print();
  }

  return (
    <button
      className="rounded-full border border-[#d6e1ce] bg-white px-4 py-2 text-xs font-bold text-[#4f6254] transition hover:border-[#9db56a] hover:text-[#15221b]"
      onClick={handlePrint}
      type="button"
    >
      {label}
    </button>
  );
}
