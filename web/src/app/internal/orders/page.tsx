import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { OrderActions } from "../../../components/order-actions";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { getOrders } from "../../../lib/data";
import { formatDate, formatNumber, statusLabel, statusTone } from "../../../lib/format";

const roles = ["admin", "logistics"] as const;

export default async function DispatchQueuePage() {
  const profile = await requireProfile(roles);
  const orders = await getOrders();
  const ready = orders.filter((order) => order.status === "approved");
  const dispatched = orders.filter((order) => order.status === "dispatched");

  return (
    <PortalShell
      description="Review approved orders, record dispatch dates, and keep dealer status progression current."
      eyebrow="Internal operations / dispatch"
      highlights={[
        "Approved orders only: an order appears here once it clears approval",
        "Mark an order dispatched with a dispatch date",
        "Dispatched history with delivery dates and tracking notes",
      ]}
      profile={profile}
      title="Move product forward."
    >
      <section className="grid gap-4 sm:grid-cols-2">
        <MetricCard detail="Approved and ready" label="Dispatch queue" value={String(ready.length).padStart(2, "0")} />
        <MetricCard detail="Visible dispatched orders" label="Dispatched" value={String(dispatched.length).padStart(2, "0")} />
      </section>
      <div className="mt-6">
        <DataPanel description="Only approved orders can be marked dispatched." title="Ready to dispatch">
          {ready.length ? (
            <div className="space-y-4">
              {ready.map((order) => (
                <div className="rounded-2xl border border-[#e8ede6] p-5" key={order.id}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold">{order.dealer?.name ?? "Dealer"}</p>
                      <p className="mt-1 text-xs text-[#819083]">Created {formatDate(order.created_at)} · ₹{formatNumber(order.total_amount)}</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(order.status)}`}>{statusLabel(order.status)}</span>
                  </div>
                  <OrderActions orderId={order.id} role={profile.role} status={order.status} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No approved orders are ready for dispatch." />
          )}
        </DataPanel>
      </div>
      <div className="mt-6">
        <DataPanel description="Recent delivery records and tracking notes." title="Dispatched history">
          {dispatched.length ? (
            <div className="divide-y divide-[#e8ede6]">
              {dispatched.map((order) => (
                <div className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0" key={order.id}>
                  <div>
                    <p className="font-semibold">{order.dealer?.name ?? "Dealer"}</p>
                    <p className="mt-1 text-xs text-[#819083]">Dispatch date {formatDate(order.dispatch_date)}</p>
                  </div>
                  <p className="text-sm text-[#5d6b60]">{order.tracking_note ?? "No tracking note"}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No dispatched orders yet." />
          )}
        </DataPanel>
      </div>
    </PortalShell>
  );
}
