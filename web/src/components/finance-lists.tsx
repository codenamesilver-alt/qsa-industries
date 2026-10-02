"use client";

// The read-mostly half of the finance screen, as client components that own their own
// search.
//
// Why these are client components rather than plain markup in the page: the finance
// screen maps over every invoice, every dealer and every payment, and at the current
// data volume that put the page at about 20,000 pixels tall. Search has to happen in
// the browser for that to be useful, and a render-prop filter cannot be passed from a
// server component to a client one, so each list takes ownership of its own rows
// instead. The data still arrives from the server as plain JSON; only the searching
// and the row markup live here.
//
// The other half of the finance screen — the invoice register, the dealer account
// payments and the dealer credit editor — use RecordPicker directly in the page,
// because those rows are collapsible and RecordPicker accepts a row's markup as a prop.
import type {
  DealerAgeingRow,
  DealerExposureRow,
  OrderRow,
  PaymentRow,
} from "../lib/data";
import {
  expenseModeLabel,
  type ExpenseLedgerRow,
  type ExpenseTotalsRow,
} from "../lib/expense";
import { formatDate, formatNumber } from "../lib/format";
import { ExpenseReceiptButton, VoidExpenseButton } from "./expense-actions";
import { GenerateInvoiceButton } from "./finance-actions";
import { RecordFilter } from "./record-picker";

/** Dispatched orders waiting for a manual invoice. */
export function InvoiceQueue({ orders }: { orders: OrderRow[] }) {
  return (
    <RecordFilter
      emptyMessage="No dispatched orders are waiting for invoices."
      collapseAfter={12}
      items={orders}
      noMatchMessage="No queued order matches that."
      placeholder="Search the queue by dealer or amount"
      searchKeys={(order) => [
        order.dealer?.name ?? "",
        order.status,
        formatDate(order.created_at),
        String(order.total_amount),
      ]}
      searchLabel="Search the invoice queue"
    >
      {(visible) => (
        <ul className="mt-4 divide-y divide-[#e8ede6]">
          {visible.map((order) => (
            <li className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0" key={order.id}>
              <div>
                <p className="font-semibold">{order.dealer?.name ?? "Dealer"}</p>
                <p className="mt-1 text-xs text-[#819083]">
                  {formatDate(order.created_at)} · ₹{formatNumber(order.total_amount)}
                </p>
              </div>
              <GenerateInvoiceButton orderId={order.id} />
            </li>
          ))}
        </ul>
      )}
    </RecordFilter>
  );
}

/** Credit used against each dealer's limit, as a bar. */
export function DealerExposureBars({ rows }: { rows: DealerExposureRow[] }) {
  return (
    <RecordFilter
      emptyMessage="No dealer exposure visible."
      collapseAfter={12}
      items={rows}
      noMatchMessage="No dealer matches that."
      placeholder="Search dealers"
      searchKeys={(row) => [row.dealer_name, String(row.exposure), String(row.credit_limit)]}
      searchLabel="Search dealer exposure"
    >
      {(visible) => (
        <ul className="mt-4 space-y-4">
          {visible.map((row) => {
            const limit = Number(row.credit_limit) || 1;
            const exposureValue = Number(row.exposure) || 0;
            const width = Math.min(100, Math.max(0, (exposureValue / limit) * 100));
            return (
              <li key={row.dealer_id}>
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span className="font-semibold">{row.dealer_name}</span>
                  <span className="text-[#5d6b60]">
                    ₹{formatNumber(row.exposure)} / ₹{formatNumber(row.credit_limit)}
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e8ede6]">
                  <div className="h-full rounded-full bg-[#7bb51d]" style={{ width: `${width}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </RecordFilter>
  );
}

/** Ageing buckets per dealer. Stays a table; the filter does not turn it into rows. */
export function InvoiceAgeingTable({ rows }: { rows: DealerAgeingRow[] }) {
  return (
    <RecordFilter
      emptyMessage="No dealer invoice ageing is visible."
      collapseAfter={15}
      items={rows}
      noMatchMessage="No dealer matches that."
      placeholder="Search the ageing table"
      searchKeys={(row) => [
        row.dealer_name,
        String(row.open_invoice_count),
        String(row.total_outstanding),
        ...[row.bucket_1_amount, row.bucket_2_amount, row.bucket_3_amount, row.bucket_4_plus_amount].map(String),
      ]}
      searchLabel="Search invoice ageing"
    >
      {(visible) => {
        const pastGrace = visible.filter(
          (row) =>
            Number(row.bucket_1_amount) +
              Number(row.bucket_2_amount) +
              Number(row.bucket_3_amount) +
              Number(row.bucket_4_plus_amount) >
            0,
        );

        return (
          <>
            {pastGrace.length ? (
              <p className="mt-4 rounded-2xl bg-[#fff7df] px-4 py-3 text-sm text-[#8b6412]">
                {pastGrace.length} dealer{pastGrace.length === 1 ? "" : "s"} in view carry balance beyond the grace
                period.
              </p>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                  <tr>
                    <th className="pb-3 pr-4 font-bold">Dealer</th>
                    <th className="pb-3 pr-4 font-bold">Open</th>
                    <th className="pb-3 pr-4 font-bold">Outstanding</th>
                    <th className="pb-3 pr-4 font-bold">Current</th>
                    <th className="pb-3 pr-4 font-bold">Bucket 1</th>
                    <th className="pb-3 pr-4 font-bold">Bucket 2</th>
                    <th className="pb-3 pr-4 font-bold">Bucket 3</th>
                    <th className="pb-3 font-bold">Bucket 4+</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8ede6]">
                  {visible.map((row) => (
                    <tr key={row.dealer_id}>
                      <td className="py-4 pr-4 font-semibold">{row.dealer_name}</td>
                      <td className="py-4 pr-4 text-[#5d6b60]">{formatNumber(row.open_invoice_count)}</td>
                      <td className="py-4 pr-4 font-semibold">₹{formatNumber(row.total_outstanding)}</td>
                      <td className="py-4 pr-4 text-[#5d6b60]">₹{formatNumber(row.current_amount)}</td>
                      <td className="py-4 pr-4 text-[#8b6412]">₹{formatNumber(row.bucket_1_amount)}</td>
                      <td className="py-4 pr-4 text-[#a33a2b]">₹{formatNumber(row.bucket_2_amount)}</td>
                      <td className="py-4 pr-4 text-[#a33a2b]">₹{formatNumber(row.bucket_3_amount)}</td>
                      <td className="py-4 text-[#a33a2b]">₹{formatNumber(row.bucket_4_plus_amount)}</td>
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

/** Every receipt on record, newest first. */
export function PaymentRegister({ payments }: { payments: PaymentRow[] }) {
  return (
    <RecordFilter
      emptyMessage="No payments recorded."
      collapseAfter={15}
      items={payments}
      noMatchMessage="No payment matches that."
      placeholder="Search receipts by dealer, invoice, reference or mode"
      searchKeys={(payment) => [
        payment.dealer?.name ?? "",
        payment.invoice?.invoice_number ?? "",
        payment.reference ?? "",
        payment.mode,
        formatDate(payment.payment_date),
        String(payment.amount),
      ]}
      searchLabel="Search the payment register"
    >
      {(visible) => (
        <ul className="mt-4 divide-y divide-[#e8ede6]">
          {visible.map((payment) => (
            <li className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0" key={payment.id}>
              <div>
                <p className="font-semibold">{payment.dealer?.name ?? "Dealer"}</p>
                <p className="mt-1 text-xs text-[#819083]">
                  {formatDate(payment.payment_date)} · {payment.invoice?.invoice_number ?? "Dealer balance"} ·{" "}
                  {payment.mode.replace("_", " ")}
                </p>
              </div>
              <p className="font-semibold text-[#4e741d]">₹{formatNumber(payment.amount)}</p>
            </li>
          ))}
        </ul>
      )}
    </RecordFilter>
  );
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

/**
 * The expense register, newest first, with the voided rows kept in place.
 *
 * A voided row is shown struck through and greyed rather than removed, and that is the
 * whole point of an append-only register: the first question after spotting a duplicate
 * is "did we pay this twice", and that question is unanswerable from a register that
 * quietly drops what it retracted. The amount stays visible next to the zero it now
 * contributes, so a row reads as "₹40,000, written off" rather than as an absence.
 */
export function ExpenseRegister({ rows }: { rows: ExpenseLedgerRow[] }) {
  return (
    <RecordFilter
      collapseAfter={15}
      emptyMessage="No expenses recorded."
      items={rows}
      noMatchMessage="No expense matches that."
      placeholder="Search by head, vendor, reference, note or amount"
      searchKeys={(row) => [
        row.head_name,
        row.vendor ?? "",
        row.reference ?? "",
        row.notes ?? "",
        expenseModeLabel(row.mode),
        formatDate(row.expense_date),
        String(row.amount),
      ]}
      searchLabel="Search the expense register"
    >
      {(visible) => (
        <ul className="mt-4 divide-y divide-[#e8ede6]">
          {visible.map((row) => (
            <li
              className={
                row.is_void
                  ? "flex flex-wrap items-start justify-between gap-4 py-4 text-[#8d938a] first:pt-0"
                  : "flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0"
              }
              key={row.id}
            >
              <div className="min-w-0">
                <p className={row.is_void ? "font-semibold line-through" : "font-semibold"}>
                  {row.head_name}
                  {!row.head_is_active ? (
                    <span className="ml-2 text-xs font-normal text-[#8d938a]">head retired</span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-[#819083]">
                  {formatDate(row.expense_date)} · {expenseModeLabel(row.mode)}
                  {row.vendor ? ` · ${row.vendor}` : ""}
                  {row.reference ? ` · ref ${row.reference}` : ""}
                </p>
                {row.notes ? <p className="mt-1 text-xs text-[#819083]">{row.notes}</p> : null}
                {row.tax_amount !== null ? (
                  <p className="mt-1 text-xs text-[#819083]">
                    Taxable ₹{formatNumber(row.taxable_amount)} + tax ₹{formatNumber(row.tax_amount)}
                  </p>
                ) : null}
                {row.attachment_path ? (
                  <ExpenseReceiptButton path={row.attachment_path} />
                ) : null}
                {row.is_void ? (
                  <p className="mt-2 rounded-lg border border-[#f0c9c2] bg-[#fdf3f1] px-2 py-1 text-xs text-[#a03a26]">
                    Voided {formatDate(row.voided_at)} — {row.void_reason}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col items-end gap-2 text-right">
                <p className={row.is_void ? "font-semibold line-through" : "font-semibold text-[#4e741d]"}>
                  ₹{formatNumber(row.amount)}
                </p>
                {row.is_void ? <p className="mt-1 text-xs">contributes ₹0</p> : null}
                {!row.is_void ? (
                  <VoidExpenseButton
                    expenseId={row.id}
                    summary={`₹${formatNumber(row.amount)} to ${row.head_name}`}
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </RecordFilter>
  );
}

/**
 * Spend grouped by head, net of voids.
 *
 * A head with no expenses still appears, because it is still a head somebody is about
 * to file under. A head whose every expense was voided reads as zero spent with the
 * voided count beside it, which is a different statement from "this head has never
 * been used" and only the first one of those is true.
 */
export function ExpenseTotalsTable({ rows }: { rows: ExpenseTotalsRow[] }) {
  return (
    <RecordFilter
      collapseAfter={15}
      emptyMessage="No expense heads defined yet."
      items={rows}
      noMatchMessage="No head matches that."
      placeholder="Search heads"
      searchKeys={(row) => [row.head_name, String(row.net_amount), String(row.expense_count)]}
      searchLabel="Search expense heads by name or spend"
    >
      {(visible) => (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead>
              <tr className="border-b border-[#dfe6dc] text-xs uppercase tracking-wide text-[#718075]">
                <th className="py-3 pr-4 font-semibold">Head</th>
                <th className="py-3 pr-4 text-right font-semibold">Expenses</th>
                <th className="py-3 pr-4 text-right font-semibold">Gross</th>
                <th className="py-3 pr-4 text-right font-semibold">Voided</th>
                <th className="py-3 text-right font-semibold">Net spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8ede6]">
              {visible.map((row) => (
                <tr className={row.head_is_active ? "" : "text-[#8d938a]"} key={row.head_id}>
                  <td className="py-3 pr-4">
                    <span className="font-semibold">{row.head_name}</span>
                    {!row.head_is_active ? (
                      <span className="ml-2 text-xs">retired</span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4 text-right">
                    {row.expense_count}
                    {row.voided_count > 0 ? (
                      <span className="ml-1 text-xs text-[#a03a26]">({row.voided_count} voided)</span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4 text-right">₹{formatNumber(row.total_amount)}</td>
                  <td className="py-3 pr-4 text-right text-[#a03a26]">
                    {Number(row.voided_amount) > 0 ? `₹${formatNumber(row.voided_amount)}` : "—"}
                  </td>
                  <td className="py-3 text-right font-semibold">₹{formatNumber(row.net_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </RecordFilter>
  );
}
