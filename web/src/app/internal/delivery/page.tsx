import { MetricCard } from "../../../components/data-panel";
import { DeliveryConfirmForm } from "../../../components/delivery-confirm-form";
import { DeliveredList, ReadyToDispatch } from "../../../components/delivery-lists";
import { CollapsiblePanel, PanelStack } from "../../../components/panel-stack";
import { PortalShell } from "../../../components/portal-shell";
import { RecordPicker, type PickerItem } from "../../../components/record-picker";
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
//
// The three lists are treated differently because they are not the same shape. The one
// carrying a confirmation form is a RecordPicker: one line per consignment, one open
// at a time, because the form is the work. The other two are read-only, so they get a
// search box and a row cap instead. Together that took the board from about 15,000
// pixels to a scannable list.
export default async function DeliveryPage() {
  const profile = await requireProfile(roles);
  const board = await getDeliveryBoard();

  const readyToDispatch = board.filter((row) => row.status === "approved" && row.delivery_status === "awaiting_dispatch");
  const inTransit = board.filter((row) => row.delivery_status === "in_transit");
  const delivered = board.filter((row) => row.delivery_status === "delivered");

  const confirmItems: PickerItem[] = inTransit.map((row) => {
    const days = Number(row.days_in_transit ?? 0);
    const age = days > 0 ? `${days} days on the road` : days < 0 ? `dispatched ${Math.abs(days)} days ahead` : "dispatched today";

    return {
      id: row.order_id,
      summary: row.dealer_name ?? "Dealer",
      detail: `${row.order_reference} · ${formatDate(row.dispatch_date)} · ${age}`,
      tags: (
        <>
          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(row.status)}`}>
            {statusLabel(row.status)}
          </span>
          <span className="rounded-full border border-[#a9d3db] bg-[#e8f7f8] px-3 py-1 text-xs font-bold text-[#276c76]">
            {statusLabel(row.delivery_status)}
          </span>
        </>
      ),
      tagText: `${statusLabel(row.status)} ${statusLabel(row.delivery_status)} ${age}`,
      searchKeys: [
        row.dealer_name ?? "",
        row.order_reference,
        row.tracking_note ?? "",
        formatNumber(row.total_amount),
        age,
      ],
      body: (
        <>
          <p className="rounded-2xl bg-[#f5f7f2] px-4 py-3 text-sm font-semibold text-[#4f6254]">
            ₹{formatNumber(row.total_amount)} · dispatched {formatDate(row.dispatch_date)}
          </p>
          {row.tracking_note ? <p className="mt-3 text-sm text-[#5d6b60]">{row.tracking_note}</p> : null}
          <div className="mt-5">
            <DeliveryConfirmForm orderId={row.order_id} orderReference={row.order_reference} />
          </div>
        </>
      ),
    };
  });

  return (
    <PortalShell
      description="Every consignment logistics still has to move, with the day count that decides which one to chase first."
      eyebrow="Internal operations / delivery"
      highlights={[
        "Orders waiting for a delivery confirmation after dispatch",
        "Confirm delivery with a note against a dispatched order",
        "Delivered history, with the confirmation note behind each delivery",
      ]}
      profile={profile}
      title="Know where every consignment is."
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard detail="Approved, not yet on a vehicle" label="Ready to dispatch" value={String(readyToDispatch.length).padStart(2, "0")} />
        <MetricCard detail="Dispatched, receipt unconfirmed" label="In transit" value={String(inTransit.length).padStart(2, "0")} />
        <MetricCard detail="Receipt confirmed by logistics" label="Delivered" value={String(delivered.length).padStart(2, "0")} />
      </section>

      <div className="mt-6 space-y-6">
        <PanelStack defaultOpenId="confirm">
          <CollapsiblePanel
            description="A delivery can only be confirmed against a dispatched consignment, so this list is the one place the button is offered. Search, then open the consignment you mean."
            id="confirm"
            summary={`${inTransit.length} in transit`}
            title="Awaiting delivery confirmation"
          >
            <RecordPicker
              collapseAfter={15}
              emptyMessage="No consignment is waiting on a delivery confirmation."
              items={confirmItems}
              noMatchMessage="No consignment matches that. Try a dealer, a reference or a tracking note."
              placeholder="Search by dealer, reference or tracking note"
              searchLabel="Search consignments awaiting confirmation"
            />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Approved orders, which dispatch from the dispatch queue before they can be delivered."
            id="ready"
            summary={`${readyToDispatch.length} approved`}
            title="Ready to dispatch"
          >
            <ReadyToDispatch rows={readyToDispatch} />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Receipt confirmed, with the note left at the time."
            id="delivered"
            summary={`${delivered.length} delivered`}
            title="Delivered"
          >
            <DeliveredList rows={delivered} />
          </CollapsiblePanel>
        </PanelStack>
      </div>
    </PortalShell>
  );
}
