import { DataPanel, EmptyState, MetricCard } from "../../components/data-panel";
import { PortalShell } from "../../components/portal-shell";
import { requireProfile } from "../../lib/auth";
import { getDealerCredit, getDealerOrders } from "../../lib/data";
import { formatDate, formatNumber, statusLabel, statusTone } from "../../lib/format";

export default async function DealerPortalPage() {
  const profile = await requireProfile(["dealer"]);
  const [orders, credit] = await Promise.all([
    getDealerOrders(),
    profile.dealer_id ? getDealerCredit(profile.dealer_id) : Promise.resolve(null),
  ]);
  const openOrders = orders.filter((order) => !["invoiced", "rejected"].includes(order.status));

  return (
    <PortalShell
      description="A focused dealer workspace for account details, catalog pricing, orders, and delivery visibility."
      eyebrow="Dealer portal"
      profile={profile}
      title="Order with clarity."
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard detail="Orders not closed" label="Open orders" value={String(openOrders.length).padStart(2, "0")} />
        <MetricCard detail="Live invoice balance" label="Outstanding" value={`₹${formatNumber(credit?.outstanding_invoices ?? 0)}`} />
        <MetricCard detail="After invoice payments and open orders" label="Available credit" value={`₹${formatNumber(credit?.available_credit ?? 0)}`} />
      </section>
      <div className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <DataPanel description="Your current credit position from the finance ledger." title="Account standing">
          {credit ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-[#718075]">Credit limit</span>
                <span className="font-semibold">₹{formatNumber(credit.credit_limit)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm text-[#718075]">Outstanding invoices</span>
                <span className="font-semibold text-[#a33a2b]">₹{formatNumber(credit.outstanding_invoices)}</span>
              </div>
              <div className="flex items-center justify-between gap-4 border-t border-[#e8ede6] pt-4">
                <span className="text-sm text-[#718075]">Available credit</span>
                <span className="text-2xl font-semibold text-[#4e741d]">₹{formatNumber(credit.available_credit)}</span>
              </div>
            </div>
          ) : (
            <EmptyState message="Credit summary is not available yet." />
          )}
        </DataPanel>
        <DataPanel description="Your latest orders and their current lifecycle state." title="Order activity">
          {orders.length ? (
            <div className="divide-y divide-[#e8ede6]">
              {orders.slice(0, 6).map((order) => (
                <div className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0" key={order.id}>
                  <div>
                    <p className="font-semibold">Order {order.id.slice(0, 8)}</p>
                    <p className="mt-1 text-xs text-[#819083]">{formatDate(order.created_at)} · {order.order_items?.length ?? 0} line items</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-semibold">₹{formatNumber(order.total_amount)}</span>
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(order.status)}`}>{statusLabel(order.status)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No orders yet. Browse the catalog to place your first order." />
          )}
        </DataPanel>
      </div>
    </PortalShell>
  );
}
