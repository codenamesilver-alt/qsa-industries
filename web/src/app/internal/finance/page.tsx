import Link from "next/link";
import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { DealerPaymentForm, GenerateInvoiceButton, PaymentForm } from "../../../components/finance-actions";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { getDealerExposure, getDealerLedger, getInvoices, getOrders, getPayments } from "../../../lib/data";
import { formatDate, formatNumber } from "../../../lib/format";

const roles = ["admin", "finance"] as const;

export default async function FinancePage() {
  const profile = await requireProfile(roles);
  const [orders, invoices, payments, ledger, exposure] = await Promise.all([
    getOrders(),
    getInvoices(),
    getPayments(),
    getDealerLedger(),
    getDealerExposure(),
  ]);
  const invoiceQueue = orders.filter((order) => order.status === "dispatched");
  const ledgerByInvoice = new Map(ledger.map((row) => [row.invoice_id, row]));
  const invoicedTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.total_amount), 0);
  const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const outstanding = ledger.reduce((sum, row) => sum + Number(row.outstanding_amount), 0);

  return (
    <PortalShell
      description="Generate GST invoices, record partial payments, and monitor dealer credit exposure against open orders and invoice balances."
      eyebrow="Internal operations / finance"
      profile={profile}
      title="Know where every rupee stands."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard detail="Ready for manual invoicing" label="Dispatch queue" value={String(invoiceQueue.length).padStart(2, "0")} />
        <MetricCard detail="Issued invoice value" label="Invoiced" value={`₹${formatNumber(invoicedTotal)}`} />
         <MetricCard detail="All recorded receipts" label="Payments" value={`₹${formatNumber(paidTotal)}`} />
         <MetricCard detail="Invoice value less allocated receipts" label="Outstanding" value={`₹${formatNumber(outstanding)}`} />
      </section>
      <div className="mt-6 flex justify-end">
        <Link
          className="rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-bold text-[#4f6254] hover:border-[#9db56a]"
          href="/api/tally/export"
        >
          Download Tally CSV
        </Link>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <DataPanel description="Invoice creation is manual and sequential." title="Invoice queue">
          {invoiceQueue.length ? (
            <div className="divide-y divide-[#e8ede6]">
              {invoiceQueue.map((order) => (
                <div className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0" key={order.id}>
                  <div>
                    <p className="font-semibold">{order.dealer?.name ?? "Dealer"}</p>
                    <p className="mt-1 text-xs text-[#819083]">{formatDate(order.created_at)} · ₹{formatNumber(order.total_amount)}</p>
                  </div>
                  <GenerateInvoiceButton orderId={order.id} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No dispatched orders are waiting for invoices." />
          )}
        </DataPanel>
        <DataPanel description="Open orders plus unpaid invoice balances within role scope." title="Dealer credit exposure">
          {exposure.length ? (
            <div className="space-y-4">
              {exposure.map((row) => {
                const limit = Number(row.credit_limit) || 1;
                const exposureValue = Number(row.exposure) || 0;
                const width = Math.min(100, Math.max(0, (exposureValue / limit) * 100));
                return (
                  <div key={row.dealer_id}>
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="font-semibold">{row.dealer_name}</span>
                      <span className="text-[#5d6b60]">₹{formatNumber(row.exposure)} / ₹{formatNumber(row.credit_limit)}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e8ede6]">
                      <div className="h-full rounded-full bg-[#7bb51d]" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState message="No dealer exposure visible." />
          )}
        </DataPanel>
       </div>
       <div className="mt-6">
           <DataPanel description="Record advance receipts for later invoice allocation or account credit." title="Dealer account payments">
           {exposure.length ? (
             <div className="space-y-5">
                {exposure.map((row) => (
                 <div className="rounded-2xl border border-[#e8ede6] p-4" key={row.dealer_id}>
                   <div className="mb-4 flex items-center justify-between gap-4">
                     <p className="font-semibold">{row.dealer_name}</p>
                     <p className="text-xs text-[#819083]">Available credit ₹{formatNumber(row.available_credit)}</p>
                   </div>
                   <DealerPaymentForm dealerId={row.dealer_id} />
                 </div>
               ))}
             </div>
           ) : (
             <EmptyState message="No dealer accounts visible." />
           )}
         </DataPanel>
       </div>
       <div className="mt-6">
         <DataPanel description="Record a payment against an invoice. Partial payments remain supported." title="Invoice register">
          {invoices.length ? (
            <div className="space-y-5">
             {invoices.map((invoice) => {
               const invoiceLedger = ledgerByInvoice.get(invoice.id);
               return (
                 <div className="rounded-2xl border border-[#e8ede6] p-4" key={invoice.id}>
                   <div className="flex flex-wrap items-center justify-between gap-4">
                     <div>
                       <p className="font-semibold">{invoice.invoice_number}</p>
                       <p className="mt-1 text-xs text-[#819083]">{invoice.dealer?.name ?? "Dealer"} · {formatDate(invoice.invoice_date)}</p>
                     </div>
                     <div className="text-right">
                       <p className="font-semibold">₹{formatNumber(invoice.total_amount)}</p>
                       <p className="mt-1 text-xs text-[#819083]">Taxable ₹{formatNumber(invoice.taxable_amount)} · GST ₹{formatNumber(invoice.gst_amount)}</p>
                       <p className="mt-1 text-xs font-semibold text-[#4e741d]">Outstanding ₹{formatNumber(invoiceLedger?.outstanding_amount ?? invoice.total_amount)}</p>
                     </div>
                   </div>
                  <div className="mt-4 border-t border-[#e8ede6] pt-4">
                    <PaymentForm invoiceId={invoice.id} />
                   </div>
                 </div>
               );
              })}
             </div>
          ) : (
            <EmptyState message="No invoices have been generated." />
          )}
        </DataPanel>
      </div>
      <div className="mt-6">
        <DataPanel description="Recent receipts by dealer and invoice." title="Payment register">
          {payments.length ? (
            <div className="divide-y divide-[#e8ede6]">
              {payments.map((payment) => (
                <div className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0" key={payment.id}>
                  <div>
                    <p className="font-semibold">{payment.dealer?.name ?? "Dealer"}</p>
                    <p className="mt-1 text-xs text-[#819083]">{formatDate(payment.payment_date)} · {payment.invoice?.invoice_number ?? "Dealer balance"}</p>
                  </div>
                  <p className="font-semibold text-[#4e741d]">₹{formatNumber(payment.amount)}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No payments recorded." />
          )}
        </DataPanel>
      </div>
    </PortalShell>
  );
}
