"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import type { DealerCatalogRow, DealerRow } from "../lib/data";
import { businessDate, formatNumber } from "../lib/format";

// create_dealer_order is the same function the dealer portal uses, with
// p_dealer_id supplied. For a sales rep it refuses any dealer that is not mapped
// to them, and for an admin it refuses a null dealer, so both callers must name
// one. The dealer list passed in is therefore a convenience for the picker: the
// RPC is the authority, and a crafted request naming an unmapped dealer is
// refused server-side.
export function ProxyOrderForm({ catalog, dealers }: { catalog: DealerCatalogRow[]; dealers: DealerRow[] }) {
  const router = useRouter();
  const [dealerId, setDealerId] = useState(dealers[0]?.id ?? "");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
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

  const dealerKnown = dealers.some((dealer) => dealer.id === dealerId);
  const deliveryDateValid = deliveryDate === "" || deliveryDate >= businessDate();
  const canSubmit = total > 0 && deliveryDateValid && dealerKnown;

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
    const supabase = createClient();
    const { error } = await supabase.rpc("create_dealer_order", {
      order_lines: lines,
      p_requested_delivery_date: deliveryDate || null,
      p_dealer_id: dealerId || null,
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      setFailed(true);
      return;
    }
    setQuantities({});
    setDeliveryDate("");
    const placedFor = dealers.find((dealer) => dealer.id === dealerId);
    setMessage(placedFor ? `Order submitted for ${placedFor.name}.` : "Order submitted.");
    router.refresh();
  }

  if (!catalog.length) {
    return <p className="text-sm text-[#718075]">No sellable products are available to order.</p>;
  }

  if (!dealers.length) {
    return (
      <p className="rounded-2xl bg-[#fff7df] px-4 py-3 text-sm text-[#8b6412]">
        No active dealers are available to you. A proxy order must name the dealer it is for, and the database checks
        that a sales rep is mapped to the dealer they name.
      </p>
    );
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">
          Dealer
          <select
            className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
            onChange={(event) => setDealerId(event.target.value)}
            value={dealerId}
          >
            {dealers.map((dealer) => (
              <option key={dealer.id} value={dealer.id}>
                {dealer.name}
                {dealer.region ? ` · ${dealer.region}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Requested delivery date
          <input
            className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
            min={businessDate()}
            onChange={(event) => setDeliveryDate(event.target.value)}
            type="date"
            value={deliveryDate}
          />
        </label>
      </div>
      {!deliveryDateValid ? (
        <p className="rounded-2xl bg-[#fff0ed] px-4 py-3 text-sm text-[#a33a2b]">
          Requested delivery date cannot be in the past.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
            <tr>
              <th className="pb-3 pr-4 font-bold">Product</th>
              <th className="pb-3 pr-4 font-bold">Available</th>
              <th className="pb-3 pr-4 font-bold">List price</th>
              <th className="pb-3 font-bold">Quantity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e8ede6]">
            {catalog.map((product) => (
              <tr key={product.product_id}>
                <td className="py-4 pr-4">
                  <p className="font-semibold text-[#15221b]">{product.product_name}</p>
                  <p className="mt-1 text-xs text-[#819083]">{product.sku} · per {product.unit_of_measure}</p>
                </td>
                <td className="py-4 pr-4 text-[#5d6b60]">{formatNumber(product.available_quantity)}</td>
                <td className="py-4 pr-4 font-semibold">₹{formatNumber(product.list_price)}</td>
                <td className="py-4">
                  <input
                    aria-label={`Quantity for ${product.product_name}`}
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
          <p className="text-sm text-[#718075]">Order total</p>
          <p className="mt-1 text-3xl font-semibold tracking-[-0.05em]">₹{formatNumber(total)}</p>
          {dealerKnown ? (
            <p className="mt-2 text-xs text-[#718075]">
              Priced at list. The dealer&apos;s own price list is applied when the order is accepted.
            </p>
          ) : null}
        </div>
        <button
          className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading || !canSubmit}
          type="submit"
        >
          {loading ? "Submitting…" : "Submit proxy order"}
        </button>
      </div>
      {message ? (
        <p
          className={`rounded-2xl px-4 py-3 text-sm ${
            failed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"
          }`}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
