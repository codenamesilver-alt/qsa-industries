"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { DealerCatalogRow, OrderRow } from "../lib/data";
import { businessDate, formatNumber } from "../lib/format";
import { PdfHelp } from "./pdf-help";

// edit_dealer_order replaces the lines of a pending order. Two things are
// deliberately not editable here and the form says so rather than offering a
// control that the RPC will refuse:
//
//   * The price. The function re-reads unit_price from the catalogue and the
//     dealer's price list, so a quantity box is the only lever. Typing a price
//     would be a pricing change disguised as a correction.
//   * The dealer. The function reads the dealer off the order it is editing, so
//     there is no dealer argument to pass and an order cannot be moved between
//     accounts by an edit.
//
// The catalogue is the dealer's own priced view, so the totals shown here are the
// ones the database will re-derive rather than a preview that can disagree.
export function OrderEditForm({ order, catalog }: { order: OrderRow; catalog: DealerCatalogRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(order.requested_delivery_date ?? "");
  const [quantities, setQuantities] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const item of order.order_items ?? []) initial[item.product_id] = String(item.quantity);
    return initial;
  });
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const total = useMemo(
    () =>
      catalog.reduce((sum, product) => {
        const quantity = Number(quantities[product.product_id] ?? 0);
        return sum + quantity * Number(product.unit_price);
      }, 0),
    [catalog, quantities],
  );

  const deliveryDateValid = deliveryDate === "" || deliveryDate >= businessDate();
  // Every line the order currently carries has to still be on the form, and
  // priced, or the edit would silently drop it. A product that has since been
  // deactivated leaves the order uneditable until someone resolves it, which is
  // the honest outcome.
  const orphanLine = (order.order_items ?? []).some((item) => !catalog.some((product) => product.product_id === item.product_id));
  const changed = useMemo(() => {
    const before = new Map((order.order_items ?? []).map((item) => [item.product_id, Number(item.quantity)]));
    const keys = new Set([...before.keys(), ...Object.keys(quantities).filter((key) => Number(quantities[key]) > 0)]);
    for (const key of keys) {
      if (Number(quantities[key] ?? 0) !== (before.get(key) ?? 0)) return true;
    }
    return (order.requested_delivery_date ?? "") !== deliveryDate;
  }, [deliveryDate, order.order_items, order.requested_delivery_date, quantities]);

  const canSubmit = total > 0 && deliveryDateValid && !orphanLine && changed;

  function setQuantity(productId: string, value: string) {
    setQuantities((current) => ({ ...current, [productId]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage("");
    setFailed(false);
    setLoading(true);
    const lines = catalog
      .filter((product) => Number(quantities[product.product_id] ?? 0) > 0)
      .map((product) => ({ product_id: product.product_id, quantity: Number(quantities[product.product_id]) }));
    const res = await fetch(`/api/orders/${order.id}/edit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_lines: lines, p_requested_delivery_date: deliveryDate || null }) });
    const json = await res.json();
    const error = res.ok ? null : { message: json.error ?? "Failed" };
    setLoading(false);
    if (error) {
      setMessage(error.message);
      setFailed(true);
      return;
    }
    setOpen(false);
    setMessage("Order updated. It is still pending, so it has not been re-approved.");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        className="mt-5 rounded-xl bg-[#eef2eb] px-4 py-2 text-xs font-bold text-[#4f6254]"
        onClick={() => {
          setOpen(true);
          setMessage("");
        }}
        type="button"
      >
        Edit this order
      </button>
    );
  }

  return (
    <form className="mt-5 space-y-5 border-t border-[#e8ede6] pt-5" onSubmit={handleSubmit}>
      <div className="flex justify-end"><PdfHelp guide="06-orders-edit" /></div>
      <p className="text-sm text-[#5d6b60]">
        Editing replaces the whole order, not one line. Prices are re-read from the catalogue and the dealer&apos;s price
        list, and stock is re-checked. Once the order is no longer pending this is closed for good, because an approval
        is a credit decision taken on a specific total.
      </p>
      {orphanLine ? (
        <p className="rounded-2xl bg-[#fff0ed] px-4 py-3 text-sm text-[#a33a2b]">
          This order carries a product that is no longer sellable, so it cannot be edited from here. It has to be
          rejected and re-entered.
        </p>
      ) : null}
      <label className="block text-sm font-semibold text-[#334536]">
        Requested delivery date
        <input
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal md:max-w-xs"
          min={businessDate()}
          onChange={(event) => setDeliveryDate(event.target.value)}
          type="date"
          value={deliveryDate}
        />
      </label>
      {!deliveryDateValid ? (
        <p className="rounded-2xl bg-[#fff0ed] px-4 py-3 text-sm text-[#a33a2b]">Requested delivery date cannot be in the past.</p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
            <tr>
              <th className="pb-3 pr-4 font-bold">Product</th>
              <th className="pb-3 pr-4 font-bold">Available</th>
              <th className="pb-3 pr-4 font-bold">Current price</th>
              <th className="pb-3 font-bold">Quantity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e8ede6]">
            {catalog.map((product) => (
              <tr key={product.product_id}>
                <td className="py-3 pr-4">
                  <p className="font-semibold text-[#15221b]">{product.product_name}</p>
                  <p className="mt-1 text-xs text-[#819083]">{product.sku}</p>
                </td>
                <td className="py-3 pr-4 text-[#5d6b60]">{formatNumber(product.available_quantity)}</td>
                <td className="py-3 pr-4 font-semibold">₹{formatNumber(product.unit_price)}</td>
                <td className="py-3">
                  <input
                    aria-label={`Edit quantity for ${product.product_name}`}
                    className="w-28 rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm"
                    max={product.available_quantity}
                    min="0"
                    onChange={(event) => setQuantity(product.product_id, event.target.value)}
                    step="0.01"
                    type="number"
                    value={quantities[product.product_id] ?? ""}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#e8ede6] pt-5">
        <div>
          <p className="text-sm text-[#718075]">Order total after this edit</p>
          <p className="mt-1 text-3xl font-semibold tracking-[-0.05em]">₹{formatNumber(total)}</p>
          <p className="mt-2 text-xs text-[#718075]">Was ₹{formatNumber(order.total_amount)}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-xl bg-[#eef2eb] px-4 py-2 text-xs font-bold text-[#4f6254]"
            onClick={() => {
              setOpen(false);
              setMessage("");
            }}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading || !canSubmit}
            type="submit"
          >
            {loading ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
      {message ? (
        <p
          className={`rounded-2xl px-4 py-3 text-sm ${failed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"}`}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
