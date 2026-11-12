import { PdfHelp } from "./pdf-help";

export function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-3xl border border-[#dfe6dc] bg-white p-6">
      <p className="text-sm font-medium text-[#718075]">{label}</p>
      <p className="mt-5 text-4xl font-semibold tracking-[-0.06em]">{value}</p>
      <p className="mt-3 text-sm text-[#718075]">{detail}</p>
    </div>
  );
}

export function DataPanel({
  title,
  description,
  children,
  helpGuide,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  helpGuide?: string;
}) {
  return (
    <section className="flex h-full flex-col rounded-[2rem] border border-[#dfe6dc] bg-white p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6f8c3b]">QSA control panel</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{title}</h2>
        </div>
        {helpGuide ? <PdfHelp guide={helpGuide} /> : null}
        {description ? <p className="max-w-md text-right text-sm leading-6 text-[#718075]">{description}</p> : null}
      </div>
      <div className="mt-7 flex-1">{children}</div>
    </section>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <p className="rounded-2xl bg-[#f5f7f2] px-4 py-5 text-sm text-[#718075]">{message}</p>;
}
