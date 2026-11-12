import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "../../../../../components/print-button";
import { requireProfile } from "../../../../../lib/auth";
import { getInvoices } from "../../../../../lib/data";
import { formatDate, formatNumber } from "../../../../../lib/format";

const roles = ["admin", "finance", "dealer"] as const;

export default async function InvoiceDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile(roles);
  const invoices = await getInvoices();
  const invoice = invoices.find((inv) => inv.id === id);
  if (!invoice) notFound();

  if (profile.role === "dealer" && profile.dealer_id && invoice.dealer_id !== profile.dealer_id) {
    notFound();
  }

  const backHref = profile.role === "dealer" ? "/dealer/orders" : "/internal/finance";

  return (
    <main className="min-h-screen bg-[#eef1ea] px-4 py-8 print:bg-white print:p-0">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link className="text-sm font-bold text-[#4f6254] hover:text-[#15221b]" href={backHref}>
            ← Back
          </Link>
          <PrintButton label="Print / Download PDF" />
        </div>

        <article className="bg-white p-8 shadow-lg print:shadow-none">
          <header className="border-b-2 border-[#15221b] pb-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-[#15221b]">QSA Industries</h1>
                <p className="text-sm text-[#5d6b60]">Poultry feed manufacturer</p>
                <p className="mt-1 text-xs text-[#819083]">
                  GSTIN: 27AAAAA0000A1Z5 · Phone: +91 00000 00000 · Email: info@qsa-industries.in
                </p>
              </div>
              <div className="text-right">
                <h2 className="text-xl font-extrabold uppercase tracking-wide text-[#15221b]">Tax invoice</h2>
                <p className="mt-1 text-sm text-[#5d6b60]">No. {invoice.invoice_number}</p>
                <p className="text-sm text-[#5d6b60]">Date: {formatDate(invoice.invoice_date)}</p>
              </div>
            </div>
          </header>

          <section className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#819083]">Bill to</p>
              <p className="mt-1 font-semibold text-[#15221b]">{invoice.dealer?.name ?? "—"}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#819083]">Reference</p>
              <p className="mt-1 text-[#5d6b60]">Order: {invoice.order_id}</p>
            </div>
          </section>

          <section className="mt-6">
            <table className="w-full text-left text-sm">
              <thead className="border-y border-[#e8ede6] bg-[#f5f7f2] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr>
                  <th className="px-3 py-2 font-bold">Description</th>
                  <th className="px-3 py-2 text-right font-bold">Taxable amount</th>
                  <th className="px-3 py-2 text-right font-bold">GST</th>
                  <th className="px-3 py-2 text-right font-bold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                <tr>
                  <td className="px-3 py-3 font-semibold text-[#15221b]">Invoice total</td>
                  <td className="px-3 py-3 text-right">₹{formatNumber(invoice.taxable_amount)}</td>
                  <td className="px-3 py-3 text-right">₹{formatNumber(invoice.gst_amount)}</td>
                  <td className="px-3 py-3 text-right font-extrabold">₹{formatNumber(invoice.total_amount)}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="mt-10 grid gap-6 text-sm sm:grid-cols-2">
            <div className="border-t border-[#e8ede6] pt-2 text-center text-[#819083]">Prepared by</div>
            <div className="border-t border-[#e8ede6] pt-2 text-center text-[#819083]">Authorized signature</div>
          </section>

          <footer className="mt-8 border-t border-[#e8ede6] pt-3 text-center text-xs text-[#819083]">
            This is a computer-generated document. QSA Industries · Poultry feed manufacturing ERP.
          </footer>
        </article>
      </div>
    </main>
  );
}
