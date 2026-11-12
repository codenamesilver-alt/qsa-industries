import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { OrderActions } from "../../../components/order-actions";
import { OrderEditForm } from "../../../components/order-edit-form";
import Link from "next/link";
import { PortalShell } from "../../../components/portal-shell";
import { ProxyOrderForm } from "../../../components/proxy-order-form";
import { ManualOrderForm } from "../../../components/manual-order-form";
import { RecordPicker, type PickerItem } from "../../../components/record-picker";
import { requireProfile } from "../../../lib/auth";
import { getActiveDealers, getDealerCatalogFor, getDealerExposure, getMappedDealers, getOrders, getProducts } from "../../../lib/data";
import { formatDate, formatNumber, statusLabel, statusTone } from "../../../lib/format";

const salesRoles = ["admin", "sales_rep", "sales_manager", "sales_director"] as const;

// create_dealer_order only lets a sales_rep or an admin raise an order on someone
// else's behalf. A sales_manager or sales_director has no such power, so the proxy
// panel is not rendered for them at all.
const proxyRoles = ["admin", "sales_rep"] as const;

// edit_dealer_order opens an order to exactly these roles, for the same reason the
// proxy panel does: a correction made for a dealer is an act done on a mapped
// account. A manager who can approve an order cannot rewrite one, because an
// approval is a credit decision and this is not.
const editRoles = ["admin", "sales_rep"] as const;

export default async function SalesOrdersPage() {
  const profile = await requireProfile(salesRoles);
  const canProxy = (proxyRoles as readonly string[]).includes(profile.role);
  const canEdit = (editRoles as readonly string[]).includes(profile.role);
  const [orders, exposure, proxyDealers, products] = await Promise.all([
    getOrders(),
    getDealerExposure(),
    // A rep may only name a dealer mapped to them; an admin may name any active
    // dealer. The RPC enforces both again, so the two lists differ only in what
    // the picker can offer.
    !canProxy
      ? Promise.resolve([])
      : profile.role === "admin"
        ? getActiveDealers()
        : getMappedDealers(),
    getProducts(),
  ]);
  const exposureByDealer = new Map(exposure.map((row) => [row.dealer_id, row]));
  const pending = orders.filter((order) => order.status === "pending");
  const directorQueue = orders.filter((order) => order.status === "pending_director_approval");
  const approved = orders.filter((order) => order.status === "approved");

  // One catalogue per dealer with an editable order, priced for that dealer. The
  // generic dealer_catalog cannot be used here: it prices the caller's own dealer,
  // and a rep or admin has none, so it would fall back to the standard tier and show
  // a total that differs from what edit_dealer_order will actually charge.
  const editableDealerIds = [...new Set(canEdit ? pending.map((order) => order.dealer_id) : [])];
  const catalogs = new Map(
    await Promise.all(
      editableDealerIds.map(async (dealerId) => [dealerId, await getDealerCatalogFor(dealerId)] as const),
    ),
  );

  // The queue is a list of orders, and it used to render one full panel per order:
  // line items, credit exposure, the action buttons and, for a rep, the whole line
  // editor. A director's page reached 20,000 pixels, which meant the order you were
  // looking for could not be found without scrolling past every order above it.
  //
  // Each order is now one collapsed row carrying the four things that decide whether
  // you care about it — dealer, status, date, total — and the panel opens only for
  // the order you chose. Nothing was removed; the contents are the same panel, one
  // order at a time.
  const orderItems: PickerItem[] = orders.map((order) => {
    const credit = order.dealer_id ? exposureByDealer.get(order.dealer_id) : undefined;
    const dealerName = order.dealer?.name ?? "Dealer order";
    const lineCount = order.order_items?.length ?? 0;

    return {
      id: order.id,
      summary: dealerName,
      detail: `${formatDate(order.created_at)} · ${lineCount} ${lineCount === 1 ? "line" : "lines"} · ₹${formatNumber(order.total_amount)}`,
      tags: (
        <>
          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(order.status)}`}>
            {statusLabel(order.status)}
          </span>
          {order.credit_override ? (
            <span className="rounded-full border border-[#f0cf86] bg-[#fff7df] px-3 py-1 text-xs font-bold text-[#8b6412]">
              Credit override
            </span>
          ) : null}
        </>
      ),
      tagText: `${statusLabel(order.status)}${order.credit_override ? " credit override" : ""}`,
      searchKeys: [
        dealerName,
        order.id,
        statusLabel(order.status),
        ...(order.order_items ?? []).map((item) => item.product?.name ?? ""),
        ...(order.order_items ?? []).map((item) => item.product?.sku ?? ""),
      ],
      body: (
        <>
          {credit ? (
            <p className="rounded-2xl bg-[#f5f7f2] px-4 py-3 text-sm text-[#5d6b60]">
              Exposure ₹{formatNumber(credit.exposure)} of ₹{formatNumber(credit.credit_limit)} · Available ₹
              {formatNumber(credit.available_credit)}
            </p>
          ) : null}
          {order.order_items?.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-sm">
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
          <div className="mt-4">
            <Link
              className="inline-flex items-center rounded-full border border-[#d6e1ce] bg-white px-4 py-2 text-xs font-bold text-[#4f6254] transition hover:border-[#9db56a] hover:text-[#15221b]"
              href={`/sales/orders/${order.id}`}
            >
              View document
            </Link>
          </div>
          <OrderActions orderId={order.id} role={profile.role} status={order.status} />
          {canEdit && order.status === "pending" ? (
            <OrderEditForm catalog={catalogs.get(order.dealer_id) ?? []} order={order} />
          ) : null}
        </>
      ),
    };
  });

  return (
    <PortalShell
      description="Review order lines, credit exposure, approvals, overrides, escalation, and dispatch readiness."
      eyebrow="Sales management / order lifecycle"
      highlights={[
        "Search the queue by dealer, status, order reference or product",
        "Open one order to see its lines, credit exposure and the actions you may take",
        "Approve an order that fits inside your approval limit",
        "Escalate an order to the director when it needs higher authority",
        "Director approval or rejection for escalated orders",
        "Raise a proxy order on behalf of a dealer",
        "Edit dealer order lines before approval",
        "Dispatch readiness: what is approved and ready to move",
      ]}
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
            <ProxyOrderForm dealers={proxyDealers} />
          </DataPanel>
        </div>
      ) : null}
      {canProxy ? (
        <div className="mt-6">
          <DataPanel
            description="Create a sales order manually for any dealer, with custom product lines and prices."
            title="Manual sales order"
          >
            <ManualOrderForm dealers={proxyDealers} products={products} />
          </DataPanel>
        </div>
      ) : null}
      <div className="mt-6">
        <DataPanel
          description="One line per order. Search first, then open the order you mean — the lines, the credit behind it and the actions you may take appear only for that order."
          title="Order queue"
        >
          <RecordPicker
            collapseAfter={25}
            emptyMessage="No orders visible in current role scope."
            items={orderItems}
            noMatchMessage="No order matches that."
            placeholder="Search orders by dealer, status or product"
            searchLabel="Search the order queue"
          />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
