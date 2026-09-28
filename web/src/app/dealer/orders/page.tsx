import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { OrderEditForm } from "../../../components/order-edit-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { getDealerCatalog, getDealerOrders } from "../../../lib/data";
import { formatDate, formatNumber, statusLabel, statusTone } from "../../../lib/format";

export default async function DealerOrdersPage() {
  const profile = await requireProfile(["dealer"]);
  const [orders, catalog] = await Promise.all([getDealerOrders(), getDealerCatalog()]);
  const open = orders.filter((order) => !["invoiced", "rejected"].includes(order.status));
  const closed = orders.filter((order) => ["invoiced", "rejected"].includes(order.status));

  return (
    <PortalShell
      description="Follow every order from submission through approval, dispatch, delivery confirmation, invoicing, and payment status."
      eyebrow="Dealer portal / orders"
      profile={profile}
      title="See every step."
    >
      <section className="grid gap-4 sm:grid-cols-2">
        <MetricCard detail="Still in progress" label="Open orders" value={String(open.length).padStart(2, "0")} />
        <MetricCard detail="Invoiced or rejected" label="Closed orders" value={String(closed.length).padStart(2, "0")} />
      </section>
      <p className="mt-4 text-xs text-[#718075]">
        Order state and consignment state are shown separately. An order can read Invoiced while the goods are still
        In transit, so both badges have to be read together.
      </p>
      <div className="mt-6 space-y-4">
        {orders.length ? (
          orders.map((order) => (
            <DataPanel key={order.id} title={`Order ${order.id.slice(0, 8)}`} description={`Submitted ${formatDate(order.created_at)}`}>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(order.status)}`}>{statusLabel(order.status)}</span>
                  {/* Consignment state is separate from the order state: an invoiced
                      order can still be on the road, so the two are shown as two
                      badges rather than one merged status. */}
                  {order.delivery_status !== "awaiting_dispatch" ? (
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(order.delivery_status)}`}>
                      {statusLabel(order.delivery_status)}
                    </span>
                  ) : null}
                  {order.dispatch_date ? <span className="text-xs text-[#718075]">Dispatch {formatDate(order.dispatch_date)}</span> : null}
                  {order.delivered_at ? <span className="text-xs text-[#718075]">Delivered {formatDate(order.delivered_at)}</span> : null}
                  {order.tracking_note ? <span className="text-xs text-[#718075]">{order.tracking_note}</span> : null}
                </div>
                <p className="text-2xl font-semibold tracking-[-0.04em]">₹{formatNumber(order.total_amount)}</p>
              </div>
              {order.order_items?.length ? (
                <div className="mt-5 divide-y divide-[#e8ede6]">
                  {order.order_items.map((item) => (
                    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0" key={item.id}>
                      <div>
                        <p className="font-semibold">{item.product?.name ?? "Product"}</p>
                        <p className="mt-1 text-xs text-[#819083]">{item.product?.sku}</p>
                      </div>
                      <p className="text-sm">{formatNumber(item.quantity)} × ₹{formatNumber(item.unit_price)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-4"><EmptyState message="Order lines are not visible." /></div>
              )}
              {/* Editable while pending only, and the window closes the moment sales
                  approve: the price shown is re-read and the total can move, and an
                  approval is a credit decision on a specific total. */}
              {order.status === "pending" ? <OrderEditForm catalog={catalog} order={order} /> : null}
            </DataPanel>
          ))
        ) : (
          <DataPanel title="Order history"><EmptyState message="No orders yet." /></DataPanel>
        )}
      </div>
    </PortalShell>
  );
}
