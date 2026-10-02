import { EmptyState, MetricCard } from "../../../components/data-panel";
import { CollapsiblePanel, PanelStack } from "../../../components/panel-stack";
import { PortalShell } from "../../../components/portal-shell";
import { PurchaseOrderForm } from "../../../components/purchase-order-form";
import { PurchaseOrderReceiveForm } from "../../../components/purchase-order-receive-form";
import { PurchaseOrderRegister } from "../../../components/purchasing-lists";
import { RecordPicker, type PickerItem } from "../../../components/record-picker";
import { requireProfile } from "../../../lib/auth";
import { getPurchaseOrders, getRawMaterialProducts } from "../../../lib/data";
import { formatDate, formatNumber, poTone, statusLabel } from "../../../lib/format";

// purchase_orders and purchase_order_lines are readable by admin, inventory,
// production and finance, but only admin and inventory_manager can write. The
// two RPCs that raise and receive a purchase order both refuse any other role, so
// the forms are gated here rather than left to fail on submit.
const readRoles = ["admin", "inventory_manager", "production_manager", "finance"] as const;

export default async function PurchasingPage() {
  const profile = await requireProfile(readRoles);
  const canWrite = profile.role === "admin" || profile.role === "inventory_manager";
  const [purchaseOrders, rawMaterials] = await Promise.all([getPurchaseOrders(), getRawMaterialProducts()]);

  const open = purchaseOrders.filter((order) => order.status !== "received" && order.status !== "cancelled");
  const awaitingReceipt = open.filter((order) => order.status === "ordered" || order.status === "partially_received");
  const committed = open.reduce((sum, order) => sum + Number(order.total_amount), 0);

  // One receipt form per waiting order used to be mounted all at once, which is where
  // the twenty-plus forms on this screen came from. Receiving is now one open order at
  // a time; the row carries the PO number, supplier, dates and status, which is
  // everything you need to decide which order to receive against.
  const receiptItems: PickerItem[] = awaitingReceipt.map((order) => ({
    id: order.id,
    summary: order.po_number,
    detail: `${order.supplier_name} · ordered ${formatDate(order.order_date)}${
      order.expected_date ? ` · expected ${formatDate(order.expected_date)}` : ""
    }`,
    tags: (
      <span className={`rounded-full border px-3 py-1 text-xs font-bold ${poTone(order.status)}`}>
        {statusLabel(order.status)}
      </span>
    ),
    tagText: `${statusLabel(order.status)} ${order.supplier_name}`,
    searchKeys: [
      order.po_number,
      order.supplier_name,
      order.supplier_gstin ?? "",
      statusLabel(order.status),
      formatNumber(order.total_amount),
    ],
    body: canWrite ? (
      <PurchaseOrderReceiveForm order={order} />
    ) : (
      <p className="text-sm text-[#718075]">Receipts are limited to inventory and admin.</p>
    ),
  }));

  return (
    <PortalShell
      description="Raise purchase orders against raw materials and receive stock against them, so production never has to guess what is on the way."
      eyebrow="Internal operations / purchasing"
      highlights={[
        "Raise a purchase order against raw materials, with supplier and expected date",
        "Receive a purchase order, in full or in part, straight into stock",
        "Purchase order register showing every PO and what has been received against it",
      ]}
      profile={profile}
      title="Buy what production will ask for."
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard detail="Raised and not yet complete" label="Open orders" value={String(open.length).padStart(2, "0")} />
        <MetricCard detail="Ordered or partly received" label="Awaiting receipt" value={String(awaitingReceipt.length).padStart(2, "0")} />
        <MetricCard detail="Value of open orders" label="Committed" value={`₹${formatNumber(committed)}`} />
      </section>

      <div className="mt-6 space-y-6">
        <PanelStack defaultOpenId="receive">
          {canWrite ? (
            <CollapsiblePanel
              description="Raw materials only, since finished goods are made in house rather than bought."
              id="raise"
              title="Raise purchase order"
            >
              {rawMaterials.length ? (
                <PurchaseOrderForm products={rawMaterials} />
              ) : (
                <EmptyState message="No active raw materials are set up to buy." />
              )}
            </CollapsiblePanel>
          ) : (
            <CollapsiblePanel description="This page is read-only for your role." id="raise" title="Raise purchase order">
              <p className="text-sm text-[#718075]">
                Raising and receiving purchase orders is limited to inventory and admin. This page is read-only for your
                role.
              </p>
            </CollapsiblePanel>
          )}

          <CollapsiblePanel
            description="Receipts post into the stock ledger and move the order to partially or fully received. Search, then open the one order you are receiving against."
            id="receive"
            summary={`${awaitingReceipt.length} waiting`}
            title="Receive against purchase order"
          >
            <RecordPicker
              collapseAfter={15}
              emptyMessage="No purchase orders are waiting to be received."
              items={receiptItems}
              noMatchMessage="No purchase order matches that. Try a PO number or a supplier."
              placeholder="Search by PO number or supplier"
              searchLabel="Search purchase orders awaiting receipt"
            />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Every raised order and how much of it has arrived."
            id="register"
            summary={`${purchaseOrders.length} orders`}
            title="Purchase order register"
          >
            <PurchaseOrderRegister rows={purchaseOrders} />
          </CollapsiblePanel>
        </PanelStack>
      </div>
    </PortalShell>
  );
}
