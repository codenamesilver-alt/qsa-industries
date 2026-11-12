import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "../../../../components/print-button";
import { requireProfile } from "../../../../lib/auth";
import { getPurchaseOrders } from "../../../../lib/data";
import { formatDate, formatNumber, statusLabel } from "../../../../lib/format";

const roles = ["admin", "inventory_manager", "production_manager", "finance"] as const;

export default async function PurchaseOrderDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile(roles);
  const orders = await getPurchaseOrders();
  const po = orders.find((o) => o.id === id);
  if (!po) notFound();

  const lines = po.purchase_order_lines ?? [];
  const backHref = "/internal/purchasing";

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
                <h2 className="text-xl font-extrabold uppercase tracking-wide text-[#15221b]">Purchase order</h2>
                <p className="mt-1 text-sm text-[#5d6b60]">No. {po.po_number}</p>
                <p className="text-sm text-[#5d6b60]">Date: {formatDate(po.order_date)}</p>
              </div>
            </div>
          </header>

          <section className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#819083]">Supplier</p>
              <p className="mt-1 font-semibold text-[#15221b]">{po.supplier_name}</p>
              <p className="text-[#5d6b60]">GSTIN: {po.supplier_gstin ?? "—"}</p>
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#819083]">Order details</p>
              <p className="mt-1 text-[#5d6b60]">Status: {statusLabel(po.status)}</p>
              <p className="text-[#5d6b60]">Expected delivery: {formatDate(po.expected_date)}</p>
              {po.received_at ? <p className="text-[#5d6b60]">Received: {formatDate(po.received_at)}</p> : null}
            </div>
          </section>

          {po.notes ? (
            <section className="mt-4 text-sm text-[#5d6b60]">
              <span className="font-bold text-[#15221b]">Notes:</span> {po.notes}
            </section>
          ) : null}

          <section className="mt-6">
            <table className="w-full text-left text-sm">
              <thead className="border-y border-[#e8ede6] bg-[#f5f7f2] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr>
                  <th className="px-3 py-2 font-bold">#</th>
                  <th className="px-3 py-2 font-bold">Product</th>
                  <th className="px-3 py-2 font-bold">SKU</th>
                  <th className="px-3 py-2 text-right font-bold">Qty</th>
                  <th className="px-3 py-2 text-right font-bold">Unit price</th>
                  <th className="px-3 py-2 text-right font-bold">Received</th>
                  <th className="px-3 py-2 text-right font-bold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {lines.length ? (
                  lines.map((line, index) => (
                    <tr key={line.id}>
                      <td className="px-3 py-2 text-[#819083]">{index + 1}</td>
                      <td className="px-3 py-2 font-semibold text-[#15221b]">{line.products?.name ?? "Product"}</td>
                      <td className="px-3 py-2 text-[#5d6b60]">{line.products?.sku ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(line.quantity)}</td>
                      <td className="px-3 py-2 text-right">₹{formatNumber(line.unit_price)}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(line.quantity_received)}</td>
                      <td className="px-3 py-2 text-right font-semibold">₹{formatNumber(line.line_total)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-3 py-3 text-[#718075]" colSpan={7}>
                      No purchase order lines recorded.
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#15221b]">
                  <td className="px-3 py-2 font-bold" colSpan={6}>
                    Total
                  </td>
                  <td className="px-3 py-2 text-right font-extrabold">₹{formatNumber(po.total_amount)}</td>
                </tr>
              </tfoot>
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
