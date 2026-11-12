import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { OrderEditForm } from "../../../components/order-edit-form";
import Link from "next/link";
import { PortalShell } from "../../../components/portal-shell";
import { RecordPicker, type PickerItem } from "../../../components/record-picker";
import { requireProfile } from "../../../lib/auth";
import { getDealerCatalog, getDealerOrders } from "../../../lib/data";
import { formatDate, formatNumber, statusLabel, statusTone } from "../../../lib/format";

export default async function DealerOrdersPage() {
  const profile = await requireProfile(["dealer"]);
  const [orders, catalog] = await Promise.all([getDealerOrders(), getDealerCatalog()]);
  const open = orders.filter((order) => !["invoiced", "rejected"].includes(order.status));
  const closed = orders.filter((order) => ["invoiced", "rejected"].includes(order.status));

  // A dealer with twenty orders does not need twenty panels stacked one under
  // another; they need to find one. Each order is a single row carrying its
  // reference, status, date and value, and the lines and the line editor appear
  // only for the order that is opened.
  const orderItems: PickerItem[] = orders.map((order) => {
    const reference = `Order ${order.id.slice(0, 8)}`;
    const lineCount = order.order_items?.length ?? 0;

    return {
      id: order.id,
      summary: reference,
      detail: `Submitted ${formatDate(order.created_at)} · ${lineCount} ${lineCount === 1 ? "line" : "lines"} · ₹${formatNumber(order.total_amount)}`,
      tags: (
        <>
          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(order.status)}`}>
            {statusLabel(order.status)}
          </span>
          {/* Consignment state is separate from the order state: an invoiced
              order can still be on the road, so the two are shown as two
              badges rather than one merged status. */}
          {order.delivery_status !== "awaiting_dispatch" ? (
            <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(order.delivery_status)}`}>
              {statusLabel(order.delivery_status)}
            </span>
          ) : null}
        </>
      ),
      tagText: `${statusLabel(order.status)} ${statusLabel(order.delivery_status)}`,
      searchKeys: [
        reference,
        statusLabel(order.status),
        statusLabel(order.delivery_status),
        order.tracking_note ?? "",
        ...(order.order_items ?? []).map((item) => item.product?.name ?? ""),
        ...(order.order_items ?? []).map((item) => item.product?.sku ?? ""),
      ],
      body: (
        <>
          {order.dispatch_date ? <p className="text-xs text-[#718075]">Dispatch {formatDate(order.dispatch_date)}</p> : null}
          {order.delivered_at ? <p className="mt-1 text-xs text-[#718075]">Delivered {formatDate(order.delivered_at)}</p> : null}
          {order.tracking_note ? <p className="mt-1 text-xs text-[#718075]">{order.tracking_note}</p> : null}
          {order.order_items?.length ? (
            <div className="mt-4 divide-y divide-[#e8ede6]">
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
          <div className="mt-4">
            <Link
              className="inline-flex items-center rounded-full border border-[#d6e1ce] bg-white px-4 py-2 text-xs font-bold text-[#4f6254] transition hover:border-[#9db56a] hover:text-[#15221b]"
              href={`/sales/orders/${order.id}`}
            >
              View document
            </Link>
          </div>
          {order.status === "pending" ? <OrderEditForm catalog={catalog} order={order} /> : null}
        </>
      ),
    };
  });

  return (
    <PortalShell
      description="Follow every order from submission through approval, dispatch, delivery confirmation, invoicing, and payment status."
      eyebrow="Dealer portal / orders"
      highlights={[
        "Search your orders by reference, status or product",
        "Open one order to see its lines and, while it is still open to change, edit them",
        "Lifecycle status from submission through approval, dispatch, delivery, invoicing and payment",
      ]}
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
      <div className="mt-6">
        <DataPanel
          description="One line per order. Search, then open the order you mean; its lines and its edit form appear only for that order."
          title="Order history"
        >
          <RecordPicker
            emptyMessage="No orders yet."
            items={orderItems}
            noMatchMessage="No order matches that. Try the order reference, a status, or a product name."
            placeholder="Search orders by reference, status or product"
            searchLabel="Search your orders"
          />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
