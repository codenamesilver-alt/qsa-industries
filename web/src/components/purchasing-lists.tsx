"use client";

// The purchase order register, which searches in the browser.
//
// The register is a table and stays a table; the receiving forms above it are a
// RecordPicker in the page, because those rows hide a form. This split is what took
// the purchasing screen from about 22 mounted forms and nine screens of scrolling
// down to one open form and a register you can search.
import Link from "next/link";
import type { PurchaseOrderRow } from "../lib/data";
import { formatDate, formatNumber, poTone, statusLabel } from "../lib/format";
import { RecordFilter } from "./record-picker";

/** Every raised order and how much of it has arrived. */
export function PurchaseOrderRegister({ rows }: { rows: PurchaseOrderRow[] }) {
  return (
    <RecordFilter
      collapseAfter={15}
      emptyMessage="No purchase orders have been raised."
      items={rows}
      noMatchMessage="No purchase order matches that. Try a PO number, a supplier or a status."
      placeholder="Search by PO number, supplier or status"
      searchKeys={(order) => [
        order.po_number,
        order.supplier_name,
        order.supplier_gstin ?? "",
        statusLabel(order.status),
        order.status,
        formatDate(order.order_date),
        formatNumber(order.total_amount),
      ]}
      searchLabel="Search the purchase order register"
    >
      {(visible) => (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
              <tr>
                <th className="pb-3 pr-4 font-bold">Order</th>
                <th className="pb-3 pr-4 font-bold">Supplier</th>
                <th className="pb-3 pr-4 font-bold">Expected</th>
                <th className="pb-3 pr-4 font-bold">Total</th>
                <th className="pb-3 font-bold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8ede6]">
              {visible.map((order) => (
                <tr key={order.id}>
                  <td className="py-4 pr-4">
                    <Link className="font-semibold text-[#4f6254] hover:text-[#15221b] hover:underline" href={`/internal/purchasing/${order.id}`}>
                       {order.po_number}
                     </Link>
                    <p className="mt-1 text-xs text-[#819083]">{formatDate(order.order_date)}</p>
                  </td>
                  <td className="py-4 pr-4 text-[#5d6b60]">
                    {order.supplier_name}
                    {order.supplier_gstin ? <p className="mt-1 text-xs text-[#819083]">{order.supplier_gstin}</p> : null}
                  </td>
                  <td className="py-4 pr-4 text-[#5d6b60]">{formatDate(order.expected_date)}</td>
                  <td className="py-4 pr-4 font-semibold">₹{formatNumber(order.total_amount)}</td>
                  <td className="py-4">
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${poTone(order.status)}`}>
                      {statusLabel(order.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </RecordFilter>
  );
}
