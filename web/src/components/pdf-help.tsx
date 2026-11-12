import Link from "next/link";

export function PdfHelp({ guide, label = "PDF Help" }: { guide: string; label?: string }) {
  const href = `/guides/${guide}.pdf`;
  return (
    <Link
      className="inline-flex items-center gap-1.5 rounded-full border border-[#d6e1ce] bg-white px-3 py-1 text-xs font-semibold text-[#4f6254] transition hover:border-[#9db56a] hover:text-[#15221b]"
      href={href}
      rel="noopener noreferrer"
      target="_blank"
    >
      <svg aria-hidden height="12" viewBox="0 0 24 24" width="12" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      {label}
    </Link>
  );
}
