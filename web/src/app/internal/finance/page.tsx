import Link from "next/link";
import { MetricCard } from "../../../components/data-panel";
import { DealerCreditForm } from "../../../components/dealer-credit-form";
import { DealerPaymentForm, PaymentForm } from "../../../components/finance-actions";
import {
  DealerExposureBars,
  InvoiceAgeingTable,
  InvoiceQueue,
  PaymentRegister,
} from "../../../components/finance-lists";
import { FinanceSettingsForm } from "../../../components/finance-settings-form";
import { CollapsiblePanel, PanelStack } from "../../../components/panel-stack";
import { PortalShell } from "../../../components/portal-shell";
import { RecordPicker, type PickerItem } from "../../../components/record-picker";
import { requireProfile } from "../../../lib/auth";
import {
  getDealerExposure,
  getDealerInvoiceAgeing,
  getDealerLedger,
  getFinanceSettings,
  getInvoices,
  getOrders,
  getPayments,
  getDealers,
  getSalesReps,
} from "../../../lib/data";
import { formatDate, formatNumber } from "../../../lib/format";

const roles = ["admin", "finance"] as const;

// Two halves of the same page, because the lists are not all the same shape.
//
// Anything with a form or a set of controls behind it is a RecordPicker: one line per
// record, one record open at a time. That is the invoice register, the dealer account
// payments and the dealer credit editor. Between them these used to mount one
// PaymentForm, one DealerPaymentForm and one DealerCreditForm per record on a single
// screen, which is where most of the 20,000-pixel height came from.
//
// Anything read-mostly is a RecordFilter inside a client component, which searches in
// the browser without turning the row into a disclosure: the invoice queue, the credit
// exposure bars, the ageing table and the payment register.
export default async function FinancePage() {
  const profile = await requireProfile(roles);
  const isAdmin = profile.role === "admin";
  const [orders, invoices, payments, ledger, exposure, ageing, settings, dealers] = await Promise.all([
    getOrders(),
    getInvoices(),
    getPayments(),
    getDealerLedger(),
    getDealerExposure(),
    getDealerInvoiceAgeing(),
    getFinanceSettings(),
    getDealers(),
  ]);
  // private.can_view_user returns true for an admin and only self for everyone
  // else, so the rep picker is read here rather than letting the query fail for
  // finance, who can manage commercial columns but never reassign a rep.
  const salesReps = isAdmin ? await getSalesReps() : [];
  const invoiceQueue = orders.filter((order) => order.status === "dispatched");
  const ledgerByInvoice = new Map(ledger.map((row) => [row.invoice_id, row]));
  const invoicedTotal = invoices.reduce((sum, invoice) => sum + Number(invoice.total_amount), 0);
  const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const outstanding = ledger.reduce((sum, row) => sum + Number(row.outstanding_amount), 0);

  const accountPaymentItems: PickerItem[] = exposure.map((row) => ({
    id: row.dealer_id,
    summary: row.dealer_name,
    detail: `Available credit ₹${formatNumber(row.available_credit)}`,
    tags: <ExposurePill creditLimit={row.credit_limit} exposure={row.exposure} />,
    tagText: exposureLabel(row.credit_limit, row.exposure),
    searchKeys: [row.dealer_name, formatNumber(row.exposure), formatNumber(row.available_credit)],
    body: <DealerPaymentForm dealerId={row.dealer_id} />,
  }));

  const invoiceItems: PickerItem[] = invoices.map((invoice) => {
    const invoiceLedger = ledgerByInvoice.get(invoice.id);
    const invoiceOutstanding = Number(invoiceLedger?.outstanding_amount ?? invoice.total_amount);
    return {
      id: invoice.id,
      summary: invoice.invoice_number,
      detail: `${invoice.dealer?.name ?? "Dealer"} · ${formatDate(invoice.invoice_date)} · ₹${formatNumber(invoice.total_amount)}`,
      tags: invoiceOutstanding > 0 ? <OutstandingPill amount={invoiceOutstanding} /> : null,
      tagText: invoiceOutstanding > 0 ? `outstanding ₹${formatNumber(invoiceOutstanding)}` : "paid in full",
      searchKeys: [
        invoice.invoice_number,
        invoice.dealer?.name ?? "",
        formatDate(invoice.invoice_date),
        formatNumber(invoice.total_amount),
        formatNumber(invoiceOutstanding),
      ],
      body: <PaymentForm invoiceId={invoice.id} />,
    };
  });

  const dealerCreditItems: PickerItem[] = dealers.map((dealer) => ({
    id: dealer.id,
    summary: dealer.name,
    detail: [dealer.city ?? null, dealer.state, dealer.region ? `${dealer.region} region` : "no region"]
      .filter(Boolean)
      .join(", "),
    tags: <StatusPill status={dealer.status} />,
    tagText: dealer.status,
    searchKeys: [dealer.name, dealer.city ?? "", dealer.state ?? "", dealer.region ?? "", dealer.email ?? "", dealer.phone ?? ""],
    body: (
      <DealerCreditForm
        canAssignRep={isAdmin}
        canManageCommercial
        dealer={dealer}
        salesReps={salesReps}
      />
    ),
  }));

  return (
    <PortalShell
      description="Generate GST invoices, record partial payments, and monitor dealer credit exposure against open orders and invoice balances."
      eyebrow="Internal operations / finance"
      highlights={[
        "Generate GST invoices against delivered orders",
        "Record an invoice payment or a dealer account payment, partial amounts supported",
        "Invoice register with each invoice, its status and the amount still outstanding",
        "Invoice ageing by bucket, and credit exposure ranked by dealer",
        "Ageing and credit settings that drive the finance calculations",
        "Dealer credit limits and regions, editable in place",
        "Payment register across invoice and account payments",
      ]}
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

      <div className="mt-6 space-y-6">
        <PanelStack defaultOpenId="register">
          <CollapsiblePanel
            description="Record a payment against an invoice. Partial payments remain supported. Search by invoice number or dealer, then open the invoice you mean."
            id="register"
            summary={`${invoices.length} invoices`}
            title="Invoice register"
          >
            <RecordPicker
              collapseAfter={15}
              emptyMessage="No invoices have been generated."
              items={invoiceItems}
              noMatchMessage="No invoice matches that. Try an invoice number or a dealer name."
              placeholder="Search by invoice number, dealer or amount"
              searchLabel="Search the invoice register"
            />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Invoice creation is manual and sequential. Dispatched orders waiting to be invoiced."
            id="queue"
            summary={`${invoiceQueue.length} waiting`}
            title="Invoice queue"
          >
            <InvoiceQueue orders={invoiceQueue} />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Record advance receipts for later invoice allocation or account credit."
            id="account-payments"
            summary={`${exposure.length} dealers`}
            title="Dealer account payments"
          >
            <RecordPicker
              collapseAfter={15}
              emptyMessage="No dealer accounts visible."
              items={accountPaymentItems}
              noMatchMessage="No dealer matches that. Try a dealer name or an available credit figure."
              placeholder="Search dealers to record an account payment"
              searchLabel="Search dealers for an account payment"
            />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Buckets are driven by the grace period and thresholds set in the settings section, so an invoice only ages once the grace period has passed."
            id="ageing"
            summary={`${ageing.length} dealers`}
            title="Invoice ageing"
          >
            <InvoiceAgeingTable rows={ageing} />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Recent receipts by dealer and invoice, newest first."
            id="payments"
            summary={`${payments.length} receipts`}
            title="Payment register"
          >
            <PaymentRegister payments={payments} />
          </CollapsiblePanel>

          <CollapsiblePanel
            description={
              isAdmin
                ? "You can change commercial columns and reassign the sales rep."
                : "You can change commercial columns. Reassigning a sales rep is an admin-only decision."
            }
            id="dealer-credit"
            summary={`${dealers.length} dealers`}
            title="Dealer credit and region"
          >
            <RecordPicker
              collapseAfter={15}
              emptyMessage="No dealer accounts are visible."
              items={dealerCreditItems}
              noMatchMessage="No dealer matches that. Try a dealer name, city, region or phone."
              placeholder="Search dealers to edit credit or region"
              searchLabel="Search dealers for credit or region"
            />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Open orders plus unpaid invoice balances within role scope."
            id="exposure"
            summary={`${exposure.length} dealers`}
            title="Dealer credit exposure"
          >
            <DealerExposureBars rows={exposure} />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Ageing thresholds and whether credit exposure counts invoices that are not yet due. Everything else on this screen ages by these numbers."
            id="settings"
            title="Ageing and credit settings"
          >
            <FinanceSettingsForm settings={settings} />
          </CollapsiblePanel>
        </PanelStack>
      </div>
    </PortalShell>
  );
}

function exposureLabel(creditLimit: number | string, exposure: number | string) {
  const limit = Number(creditLimit) || 0;
  const used = Number(exposure) || 0;
  if (limit <= 0) return "no limit set";
  const share = Math.round((used / limit) * 100);
  if (share >= 100) return "over limit";
  if (share >= 75) return "near limit";
  return "within limit";
}

function ExposurePill({ creditLimit, exposure }: { creditLimit: number | string; exposure: number | string }) {
  const label = exposureLabel(creditLimit, exposure);
  const tone =
    label === "over limit"
      ? "border-[#f2b8ad] bg-[#fff0ed] text-[#a33a2b]"
      : label === "near limit"
        ? "border-[#f0d79a] bg-[#fff7df] text-[#8b6412]"
        : "border-[#b9d98a] bg-[#eff8df] text-[#4e741d]";

  return <span className={`rounded-full border px-3 py-1 text-xs font-bold ${tone}`}>{label}</span>;
}

function OutstandingPill({ amount }: { amount: number }) {
  return (
    <span className="rounded-full border border-[#f0d79a] bg-[#fff7df] px-3 py-1 text-xs font-bold text-[#8b6412]">
      ₹{formatNumber(amount)} due
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const active = status === "active";
  return (
    <span
      className={`rounded-full border px-3 py-1 text-xs font-bold ${
        active
          ? "border-[#b9d98a] bg-[#eff8df] text-[#4e741d]"
          : "border-[#f2b8ad] bg-[#fff0ed] text-[#a33a2b]"
      }`}
    >
      {status}
    </span>
  );
}
