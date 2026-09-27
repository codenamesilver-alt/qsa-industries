import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { PortalShell } from "../../../components/portal-shell";
import { PurchaseOrderForm } from "../../../components/purchase-order-form";
import { PurchaseOrderReceiveForm } from "../../../components/purchase-order-receive-form";
import { requireProfile } from "../../../lib/auth";
import { getPurchaseOrders, getRawMaterialProducts } from "../../../lib/data";
import { formatDate, formatNumber, statusLabel } from "../../../lib/format";

// purchase_orders and purchase_order_lines are readable by admin, inventory,
// production and finance, but only admin and inventory_manager can write. The
// two RPCs that raise and receive a purchase order both refuse any other role, so
// the forms are gated here rather than left to fail on submit.
const readRoles = ["admin", "inventory_manager", "production_manager", "finance"] as const;

const poTone = (status: string) => {
  if (status === "received") return "border-[#b9d98a] bg-[#eff8df] text-[#4e741d]";
  if (status === "partially_received") return "border-[#a9d3db] bg-[#e8f7f8] text-[#276c76]";
  if (status === "cancelled") return "border-[#f2b8ad] bg-[#fff0ed] text-[#a33a2b]";
  return "border-[#d6e1ce] bg-[#f5f7f2] text-[#4f6254]";
};

export default async function PurchasingPage() {
  const profile = await requireProfile(readRoles);
  const canWrite = profile.role === "admin" || profile.role === "inventory_manager";
  const [purchaseOrders, rawMaterials] = await Promise.all([getPurchaseOrders(), getRawMaterialProducts()]);

  const open = purchaseOrders.filter((order) => order.status !== "received" && order.status !== "cancelled");
  const awaitingReceipt = open.filter((order) => order.status === "ordered" || order.status === "partially_received");
  const committed = open.reduce((sum, order) => sum + Number(order.total_amount), 0);

  return (
    <PortalShell
      description="Raise purchase orders against raw materials and receive stock against them, so production never has to guess what is on the way."
      eyebrow="Internal operations / purchasing"
      profile={profile}
      title="Buy what production will ask for."
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard detail="Raised and not yet complete" label="Open orders" value={String(open.length).padStart(2, "0")} />
        <MetricCard detail="Ordered or partly received" label="Awaiting receipt" value={String(awaitingReceipt.length).padStart(2, "0")} />
        <MetricCard detail="Value of open orders" label="Committed" value={`₹${formatNumber(committed)}`} />
      </section>

      {canWrite ? (
        <div className="mt-6">
          <DataPanel
            description="Raw materials only, since finished goods are made in house rather than bought."
            title="Raise purchase order"
          >
            {rawMaterials.length ? (
              <PurchaseOrderForm products={rawMaterials} />
            ) : (
              <EmptyState message="No active raw materials are set up to buy." />
            )}
          </DataPanel>
        </div>
      ) : (
        <div className="mt-6">
          <DataPanel title="Raise purchase order">
            <p className="text-sm text-[#718075]">
              Raising and receiving purchase orders is limited to inventory and admin. This page is read-only for your
              role.
            </p>
          </DataPanel>
        </div>
      )}

      <div className="mt-6 space-y-6">
        <DataPanel
          description="Receipts post into the stock ledger and move the order to partially or fully received."
          title="Receive against purchase order"
        >
          {awaitingReceipt.length ? (
            <div className="space-y-6">
              {awaitingReceipt.map((order) => (
                <div className="rounded-2xl border border-[#e8ede6] p-4" key={order.id}>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{order.po_number}</p>
                      <p className="mt-1 text-xs text-[#819083]">
                        {order.supplier_name} · ordered {formatDate(order.order_date)}
                        {order.expected_date ? ` · expected ${formatDate(order.expected_date)}` : ""}
                      </p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${poTone(order.status)}`}>
                      {statusLabel(order.status)}
                    </span>
                  </div>
                  {canWrite ? (
                    <PurchaseOrderReceiveForm order={order} />
                  ) : (
                    <p className="text-sm text-[#718075]">Receipts are limited to inventory and admin.</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No purchase orders are waiting to be received." />
          )}
        </DataPanel>

        <DataPanel description="Every raised order and how much of it has arrived." title="Purchase order register">
          {purchaseOrders.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                  <tr>
                    <th className="pb-3 pr-4 font-bold">Order</th>
                    <th className="pb-3 pr-4 font-bold">Supplier</th>
                    <th className="pb-3 pr-4 font-bold">Expected</th>
                    <th className="pb-3 pr-4 font-bold">Total</th>
                    <th className="pb-3 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8ede6]">
                  {purchaseOrders.map((order) => (
                    <tr key={order.id}>
                      <td className="py-4 pr-4">
                        <p className="font-semibold">{order.po_number}</p>
                        <p className="mt-1 text-xs text-[#819083]">{formatDate(order.order_date)}</p>
                      </td>
                      <td className="py-4 pr-4 text-[#5d6b60]">
                        {order.supplier_name}
                        {order.supplier_gstin ? (
                          <p className="mt-1 text-xs text-[#819083]">{order.supplier_gstin}</p>
                        ) : null}
                      </td>
                      <td className="py-4 pr-4 text-[#5d6b60]">{formatDate(order.expected_date)}</td>
                      <td className="py-4 pr-4 font-semibold">₹{formatNumber(order.total_amount)}</td>
                      <td className="py-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${poTone(order.status)}`}>
                          {statusLabel(order.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="No purchase orders have been raised." />
          )}
        </DataPanel>
      </div>
    </PortalShell>
  );
}
