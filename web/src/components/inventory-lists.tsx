"use client";

// The three read-only lists on the inventory screen, which search in the browser.
//
// None of these rows hides a form, so none of them is a disclosure row. They are
// tables and a history list, and the problem they had was height: the stock ledger,
// the batch queue and the movement history together put the page past 11,000 pixels,
// so the product you needed was somewhere below every other product. Each gets a
// search box and a row cap, and the cap lifts as soon as someone types.
import type { ExpiringBatchRow, InventoryRow, StockMovementRow } from "../lib/data";
import { expiryTone, formatDate, formatNumber } from "../lib/format";
import { RecordFilter } from "./record-picker";

/** Current quantity, threshold and replenishment state, per product. */
export function StockLedger({ rows }: { rows: InventoryRow[] }) {
  return (
    <RecordFilter
      collapseAfter={15}
      emptyMessage="No stock positions visible."
      items={rows}
      noMatchMessage="No product matches that. Try a name, a SKU or a category."
      placeholder="Search by product, SKU or category"
      searchKeys={(row) => [
        row.product_name,
        row.sku,
        row.category,
        row.low_stock ? "replenish" : "healthy",
        formatNumber(row.current_quantity),
      ]}
      searchLabel="Search the stock ledger"
    >
      {(visible) => (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
              <tr>
                <th className="pb-3 pr-4 font-bold">Product</th>
                <th className="pb-3 pr-4 font-bold">Available</th>
                <th className="pb-3 pr-4 font-bold">Threshold</th>
                <th className="pb-3 font-bold">Signal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8ede6]">
              {visible.map((row) => (
                <tr key={row.product_id}>
                  <td className="py-4 pr-4">
                    <p className="font-semibold">{row.product_name}</p>
                    <p className="mt-1 text-xs text-[#819083]">
                      {row.sku} · {row.category}
                    </p>
                  </td>
                  <td className="py-4 pr-4 font-semibold">
                    {formatNumber(row.current_quantity)} {row.unit_of_measure}
                  </td>
                  <td className="py-4 pr-4 text-[#5d6b60]">{formatNumber(row.low_stock_threshold)}</td>
                  <td className="py-4">
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-bold ${
                        row.low_stock
                          ? "border-[#f0cf86] bg-[#fff7df] text-[#8b6412]"
                          : "border-[#b9d98a] bg-[#eff8df] text-[#4e741d]"
                      }`}
                    >
                      {row.low_stock ? "Replenish" : "Healthy"}
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

/** Open batches in the order dispatch will draw them, soonest expiry first. */
export function BatchQueue({ rows }: { rows: ExpiringBatchRow[] }) {
  return (
    <RecordFilter
      collapseAfter={15}
      emptyMessage="No open batches. Receive stock into a batch to make it traceable."
      items={rows}
      noMatchMessage="No batch matches that. Try a batch code or a product."
      placeholder="Search by batch code, product or expiry state"
      searchKeys={(row) => [
        row.batch_code,
        row.product_name,
        row.sku,
        row.expiry_status,
        formatDate(row.expiry_date),
      ]}
      searchLabel="Search the batch and expiry queue"
    >
      {(visible) => {
        // Counted over what is on screen, not over everything, so the warning cannot
        // describe rows that a search has filtered out.
        const atRisk = visible.filter(
          (batch) => batch.expiry_status === "expired" || batch.expiry_status === "critical",
        );

        return (
          <>
            {atRisk.length ? (
              <p className="mt-4 rounded-2xl bg-[#fff7df] px-4 py-3 text-sm text-[#8b6412]">
                {atRisk.length} batch{atRisk.length === 1 ? "" : "es"} need attention: already expired, or within 30 days.
                Dispatch will not draw on an expired batch.
              </p>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                  <tr>
                    <th className="pb-3 pr-4 font-bold">Batch</th>
                    <th className="pb-3 pr-4 font-bold">Product</th>
                    <th className="pb-3 pr-4 font-bold">Available</th>
                    <th className="pb-3 pr-4 font-bold">Expiry</th>
                    <th className="pb-3 font-bold">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8ede6]">
                  {visible.map((batch) => (
                    <tr key={batch.batch_id}>
                      <td className="py-4 pr-4">
                        <p className="font-semibold">{batch.batch_code}</p>
                        <p className="mt-1 text-xs text-[#819083]">Made {formatDate(batch.manufacture_date)}</p>
                      </td>
                      <td className="py-4 pr-4">
                        <p className="font-semibold">{batch.product_name}</p>
                        <p className="mt-1 text-xs text-[#819083]">{batch.sku}</p>
                      </td>
                      <td className="py-4 pr-4 font-semibold">{formatNumber(batch.available_quantity)}</td>
                      <td className="py-4 pr-4 text-[#5d6b60]">
                        {formatDate(batch.expiry_date)}
                        <p className="mt-1 text-xs text-[#819083]">{formatNumber(batch.days_remaining)} days left</p>
                      </td>
                      <td className="py-4">
                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-bold ${expiryTone(batch.expiry_status)}`}
                        >
                          {batch.expiry_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        );
      }}
    </RecordFilter>
  );
}

/** Newest movement records visible in the caller's role scope. */
export function MovementHistory({ rows }: { rows: StockMovementRow[] }) {
  return (
    <RecordFilter
      collapseAfter={20}
      emptyMessage="No stock movements visible."
      items={rows}
      noMatchMessage="No movement matches that."
      placeholder="Search movements by product, source or reason"
      searchKeys={(movement) => [
        movement.product?.name ?? "",
        movement.product?.sku ?? "",
        movement.source,
        movement.movement_type,
        movement.reason ?? "",
        formatDate(movement.created_at),
      ]}
      searchLabel="Search stock movements"
    >
      {(visible) => (
        <ul className="mt-4 divide-y divide-[#e8ede6]">
          {visible.map((movement) => (
            <li className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0" key={movement.id}>
              <div>
                <p className="font-semibold">{movement.product?.name ?? "Product"}</p>
                <p className="mt-1 text-xs text-[#819083]">
                  {formatDate(movement.created_at)} · {movement.source}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={`font-semibold ${
                    movement.movement_type === "in" ? "text-[#4e741d]" : "text-[#a33a2b]"
                  }`}
                >
                  {movement.movement_type === "in" ? "+" : "−"}
                  {formatNumber(movement.quantity)}
                </p>
                {movement.reason ? <p className="mt-1 text-xs text-[#819083]">{movement.reason}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </RecordFilter>
  );
}
