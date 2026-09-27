import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { OrderActions } from "../../../components/order-actions";
import { PortalShell } from "../../../components/portal-shell";
import { ProxyOrderForm } from "../../../components/proxy-order-form";
import { requireProfile } from "../../../lib/auth";
import { getActiveDealers, getDealerCatalog, getDealerExposure, getMappedDealers, getOrders } from "../../../lib/data";
import { formatDate, formatNumber, statusLabel, statusTone } from "../../../lib/format";

const salesRoles = ["admin", "sales_rep", "sales_manager", "sales_director"] as const;

// create_dealer_order only lets a sales_rep or an admin raise an order on someone
// else's behalf. A sales_manager or sales_director has no such power, so the proxy
// panel is not rendered for them at all.
const proxyRoles = ["admin", "sales_rep"] as const;

export default async function SalesOrdersPage() {
  const profile = await requireProfile(salesRoles);
  const canProxy = (proxyRoles as readonly string[]).includes(profile.role);
  const [orders, exposure, catalog, proxyDealers] = await Promise.all([
    getOrders(),
    getDealerExposure(),
    canProxy ? getDealerCatalog() : Promise.resolve([]),
    // A rep may only name a dealer mapped to them; an admin may name any active
    // dealer. The RPC enforces both again, so the two lists differ only in what
    // the picker can offer.
    !canProxy
      ? Promise.resolve([])
      : profile.role === "admin"
        ? getActiveDealers()
        : getMappedDealers(),
  ]);
  const exposureByDealer = new Map(exposure.map((row) => [row.dealer_id, row]));
  const pending = orders.filter((order) => order.status === "pending");
  const directorQueue = orders.filter((order) => order.status === "pending_director_approval");
  const approved = orders.filter((order) => order.status === "approved");

  return (
    <PortalShell
      description="Review order lines, credit exposure, approvals, overrides, escalation, and dispatch readiness."
      eyebrow="Sales management / order lifecycle"
      profile={profile}
      title="Keep orders moving."
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard detail="Visible pending orders" label="Manager queue" value={String(pending.length).padStart(2, "0")} />
        <MetricCard detail="Visible escalated orders" label="Director queue" value={String(directorQueue.length).padStart(2, "0")} />
        <MetricCard detail="Ready for dispatch" label="Approved" value={String(approved.length).padStart(2, "0")} />
      </section>
      {canProxy ? (
        <div className="mt-6">
          <DataPanel
            description={
              profile.role === "sales_rep"
                ? "Raise an order for a dealer mapped to your account. The database refuses any dealer that is not mapped to you, whatever this form sends."
                : "Raise an order on behalf of any active dealer, for data repair taken over the phone."
            }
            title="Proxy order"
          >
            <ProxyOrderForm catalog={catalog} dealers={proxyDealers} />
          </DataPanel>
        </div>
      ) : null}
      <div className="mt-6 space-y-4">
        {orders.length ? (
          orders.map((order) => {
            const credit = order.dealer_id ? exposureByDealer.get(order.dealer_id) : undefined;
            return (
              <DataPanel key={order.id} title={order.dealer?.name ?? "Dealer order"} description={`Created ${formatDate(order.created_at)} · ${order.order_items?.length ?? 0} line items`}>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(order.status)}`}>{statusLabel(order.status)}</span>
                    {order.credit_override ? <span className="rounded-full border border-[#f0cf86] bg-[#fff7df] px-3 py-1 text-xs font-bold text-[#8b6412]">Credit override</span> : null}
                  </div>
                  <p className="text-2xl font-semibold tracking-[-0.04em]">₹{formatNumber(order.total_amount)}</p>
                </div>
                {credit ? (
                  <p className="mt-4 rounded-2xl bg-[#f5f7f2] px-4 py-3 text-sm text-[#5d6b60]">
                    Exposure ₹{formatNumber(credit.exposure)} of ₹{formatNumber(credit.credit_limit)} · Available ₹{formatNumber(credit.available_credit)}
                  </p>
                ) : null}
                {order.order_items?.length ? (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-sm">
                      <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                        <tr>
                          <th className="pb-3 pr-4 font-bold">Product</th>
                          <th className="pb-3 pr-4 font-bold">Quantity</th>
                          <th className="pb-3 pr-4 font-bold">Unit price</th>
                          <th className="pb-3 font-bold">Line total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#e8ede6]">
                        {order.order_items.map((item) => (
                          <tr key={item.id}>
                            <td className="py-3 pr-4">
                              <p className="font-semibold">{item.product?.name ?? "Product"}</p>
                              <p className="mt-1 text-xs text-[#819083]">{item.product?.sku}</p>
                            </td>
                            <td className="py-3 pr-4">{formatNumber(item.quantity)}</td>
                            <td className="py-3 pr-4">₹{formatNumber(item.unit_price)}</td>
                            <td className="py-3 font-semibold">₹{formatNumber(item.line_total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState message="Order lines are not visible in current role scope." />
                )}
                <OrderActions orderId={order.id} role={profile.role} status={order.status} />
              </DataPanel>
            );
          })
        ) : (
          <DataPanel title="Order queue"><EmptyState message="No orders visible in current role scope." /></DataPanel>
        )}
      </div>
    </PortalShell>
  );
}
