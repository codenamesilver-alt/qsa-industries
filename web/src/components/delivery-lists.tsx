"use client";

// The two read-mostly halves of the delivery board, which search in the browser.
//
// The board is the screen logistics uses to decide which consignment to chase first,
// and it had grown to about 15,000 pixels because every consignment was rendered in
// full at once. The awaiting-confirmation list, which is the only one carrying a form,
// is a RecordPicker in the page itself; these two are plain rows, so they get a
// search box and a row cap instead of a disclosure per consignment.
import type { DeliveryBoardRow } from "../lib/data";
import { formatDate, formatNumber, statusLabel, statusTone } from "../lib/format";
import { RecordFilter } from "./record-picker";

/** Approved orders waiting for a vehicle, before dispatch. */
export function ReadyToDispatch({ rows }: { rows: DeliveryBoardRow[] }) {
  return (
    <RecordFilter
      collapseAfter={15}
      emptyMessage="No approved order is waiting for a vehicle."
      items={rows}
      noMatchMessage="No consignment matches that."
      placeholder="Search by dealer, reference or amount"
      searchKeys={(row) => [
        row.dealer_name ?? "",
        row.order_reference,
        statusLabel(row.status),
        formatNumber(row.total_amount),
      ]}
      searchLabel="Search orders ready to dispatch"
    >
      {(visible) => (
        <ul className="mt-4 divide-y divide-[#e8ede6]">
          {visible.map((row) => (
            <li className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0" key={row.order_id}>
              <div>
                <p className="font-semibold">{row.dealer_name ?? "Dealer"}</p>
                <p className="mt-1 text-xs text-[#819083]">
                  {row.order_reference} · ₹{formatNumber(row.total_amount)}
                </p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(row.status)}`}>
                {statusLabel(row.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </RecordFilter>
  );
}

/** Confirmed deliveries, with the note left at the time. */
export function DeliveredList({ rows }: { rows: DeliveryBoardRow[] }) {
  return (
    <RecordFilter
      collapseAfter={15}
      emptyMessage="No delivery has been confirmed yet."
      items={rows}
      noMatchMessage="No delivery matches that."
      placeholder="Search deliveries by dealer, reference or note"
      searchKeys={(row) => [
        row.dealer_name ?? "",
        row.order_reference,
        row.delivery_note ?? "",
        formatDate(row.delivered_at),
      ]}
      searchLabel="Search confirmed deliveries"
    >
      {(visible) => (
        <ul className="mt-4 divide-y divide-[#e8ede6]">
          {visible.map((row) => (
            <li className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0" key={row.order_id}>
              <div>
                <p className="font-semibold">{row.dealer_name ?? "Dealer"}</p>
                <p className="mt-1 text-xs text-[#819083]">
                  {row.order_reference} · confirmed {formatDate(row.delivered_at)}
                </p>
                {row.delivery_note ? <p className="mt-2 text-sm text-[#5d6b60]">{row.delivery_note}</p> : null}
              </div>
              <span className="rounded-full border border-[#b9d98a] bg-[#eff8df] px-3 py-1 text-xs font-bold text-[#4e741d]">
                {statusLabel(row.delivery_status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </RecordFilter>
  );
}
