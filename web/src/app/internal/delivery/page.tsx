import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { DeliveryConfirmForm } from "../../../components/delivery-confirm-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { getDeliveryBoard } from "../../../lib/data";
import { formatDate, formatNumber, statusLabel, statusTone } from "../../../lib/format";

const roles = ["admin", "logistics"] as const;

// The board is a view, not a query, and that is the whole reason it exists. A
// direct read of orders joined to dealers returns nothing for logistics, because
// the dealers policy hides every row from that role while the orders policy does
// not. delivery_board takes the label from private.dealer_display_name instead, so
// the one role that has to act on every consignment in the country sees the whole
// board rather than an empty page.
export default async function DeliveryPage() {
  const profile = await requireProfile(roles);
  const board = await getDeliveryBoard();

  const readyToDispatch = board.filter((row) => row.status === "approved" && row.delivery_status === "awaiting_dispatch");
  const inTransit = board.filter((row) => row.delivery_status === "in_transit");
  const delivered = board.filter((row) => row.delivery_status === "delivered");

  return (
    <PortalShell
      description="Every consignment logistics still has to move, with the day count that decides which one to chase first."
      eyebrow="Internal operations / delivery"
      profile={profile}
      title="Know where every consignment is."
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard detail="Approved, not yet on a vehicle" label="Ready to dispatch" value={String(readyToDispatch.length).padStart(2, "0")} />
        <MetricCard detail="Dispatched, receipt unconfirmed" label="In transit" value={String(inTransit.length).padStart(2, "0")} />
        <MetricCard detail="Receipt confirmed by logistics" label="Delivered" value={String(delivered.length).padStart(2, "0")} />
      </section>

      <div className="mt-6">
        <DataPanel
          description="A delivery can only be confirmed against a dispatched consignment, so this list is the one place the button is offered."
          title="Awaiting delivery confirmation"
        >
          {inTransit.length ? (
            <div className="space-y-4">
              {inTransit.map((row) => (
                <div className="rounded-2xl border border-[#e8ede6] p-5" key={row.order_id}>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="font-semibold">{row.dealer_name ?? "Dealer"}</p>
                      <p className="mt-1 text-xs text-[#819083]">
                        {row.order_reference} · dispatched {formatDate(row.dispatch_date)} · ₹
                        {formatNumber(row.total_amount)}
                      </p>
                      <p className="mt-1 text-xs text-[#819083]">
                        {Number(row.days_in_transit ?? 0) > 0
                          ? `${row.days_in_transit} days on the road`
                          : Number(row.days_in_transit ?? 0) < 0
                            ? `Dispatched ${Math.abs(Number(row.days_in_transit))} days ahead`
                            : "Dispatched today"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(row.status)}`}>
                        {statusLabel(row.status)}
                      </span>
                      <span className="rounded-full border border-[#a9d3db] bg-[#e8f7f8] px-3 py-1 text-xs font-bold text-[#276c76]">
                        {statusLabel(row.delivery_status)}
                      </span>
                    </div>
                  </div>
                  {row.tracking_note ? <p className="mt-3 text-sm text-[#5d6b60]">{row.tracking_note}</p> : null}
                  <div className="mt-5">
                    <DeliveryConfirmForm orderId={row.order_id} orderReference={row.order_reference} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No consignment is waiting on a delivery confirmation." />
          )}
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel description="Approved orders, which dispatch from the dispatch queue before they can be delivered." title="Ready to dispatch">
          {readyToDispatch.length ? (
            <div className="divide-y divide-[#e8ede6]">
              {readyToDispatch.map((row) => (
                <div className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0" key={row.order_id}>
                  <div>
                    <p className="font-semibold">{row.dealer_name ?? "Dealer"}</p>
                    <p className="mt-1 text-xs text-[#819083]">
                      {row.order_reference} · ₹{formatNumber(row.total_amount)}
                    </p>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(row.status)}`}>
                    {statusLabel(row.status)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No approved order is waiting for a vehicle." />
          )}
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel description="Receipt confirmed, with the note left at the time." title="Delivered">
          {delivered.length ? (
            <div className="divide-y divide-[#e8ede6]">
              {delivered.map((row) => (
                <div className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0" key={row.order_id}>
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
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No delivery has been confirmed yet." />
          )}
        </DataPanel>
      </div>
    </PortalShell>
  );
}
