"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
//
// The catalogue is fetched per selected dealer rather than passed in, because the
// price a rep sees has to be the price the order will be charged. create_dealer_order
// resolves the line against the dealer's own price list, so a dealer with a
// negotiated price would otherwise be shown a standard-tier total and the rep would
// discover the difference only after submission. dealer_catalog_for prices a named
// dealer and refuses anyone the rep may not price, so the fetch cannot be pointed at
// another account's prices.
export function ProxyOrderForm({ dealers }: { dealers: DealerRow[] }) {
  const router = useRouter();
  const [dealerId, setDealerId] = useState(dealers[0]?.id ?? "");
  // The rows are stored together with the dealer they were priced for, rather than
  // cleared when the selection changes. A useEffect that calls setCatalog([]) to
  // empty the table on a dealer change is a synchronous setState in the effect body,
  // and it still leaves one render where the previous dealer's prices sit under the
  // new dealer's name. Reading the rows only when they belong to the selected dealer
  // means the wrong prices are never rendered, with no extra state to keep in step.
  const [loaded, setLoaded] = useState<{ dealerId: string; rows: DealerCatalogRow[] } | null>(null);
  const [deliveryDate, setDeliveryDate] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Memoised so the running total below is not recomputed on every keystroke: an
  // inline derivation would be a fresh array each render, which is a changed
  // dependency for the useMemo even when the rows themselves are identical.
  const catalog = useMemo(
    () => (loaded?.dealerId === dealerId ? loaded.rows : []),
    [loaded, dealerId],
  );
  // True until rows for the selected dealer arrive, so the form cannot be submitted
  // against an empty or stale catalogue. Derived, so it is already correct on the
  // render where the selection changes.
  const catalogLoading = dealerId !== "" && loaded?.dealerId !== dealerId;

  useEffect(() => {
    if (!dealerId) {
      return;
    }
    let live = true;
    // The Supabase query builder is thenable but not a full Promise, so it is
    // awaited inside an async function rather than chained with .then/.finally.
    const load = async () => {
      const { data, error } = await createClient().rpc("dealer_catalog_for", { target_dealer_id: dealerId });
      if (!live) return;
      if (error) {
        setMessage(error.message);
        setFailed(true);
        setLoaded({ dealerId, rows: [] });
      } else {
        setLoaded({ dealerId, rows: (data ?? []) as DealerCatalogRow[] });
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [dealerId]);

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
  const canSubmit = total > 0 && deliveryDateValid && dealerKnown && !catalogLoading;

  function setQuantity(productId: string, value: string) {
    setQuantities((current) => ({ ...current, [productId]: value }));
  }

  function changeDealer(nextDealerId: string) {
    // Quantities are kept per product, and the product set is the same catalogue
    // for every dealer, so they survive a dealer change. What cannot survive is the
    // running total, which was priced for the previous dealer.
    setDealerId(nextDealerId);
    setMessage("");
    setFailed(false);
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
            onChange={(event) => changeDealer(event.target.value)}
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

      {catalogLoading ? (
        <p className="text-sm text-[#718075]">Loading this dealer&apos;s prices…</p>
      ) : catalog.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
              <tr>
                <th className="pb-3 pr-4 font-bold">Product</th>
                <th className="pb-3 pr-4 font-bold">Available</th>
                <th className="pb-3 pr-4 font-bold">Dealer price</th>
                <th className="pb-3 font-bold">Quantity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e8ede6]">
              {catalog.map((product) => (
                <tr key={product.product_id}>
                  <td className="py-4 pr-4">
                    <p className="font-semibold text-[#15221b]">{product.product_name}</p>
                    <p className="mt-1 text-xs text-[#819083]">
                      {product.sku} · per {product.unit_of_measure}
                    </p>
                  </td>
                  <td className="py-4 pr-4 text-[#5d6b60]">{formatNumber(product.available_quantity)}</td>
                  <td className="py-4 pr-4 font-semibold">
                    ₹{formatNumber(product.unit_price)}
                    {Number(product.unit_price) !== Number(product.list_price) ? (
                      <span className="ml-2 text-xs font-normal text-[#718075] line-through">₹{formatNumber(product.list_price)}</span>
                    ) : null}
                  </td>
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
      ) : (
        <p className="text-sm text-[#718075]">No sellable products are available to order for this dealer.</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#e8ede6] pt-5">
        <div>
          <p className="text-sm text-[#718075]">Order total</p>
          <p className="mt-1 text-3xl font-semibold tracking-[-0.05em]">₹{formatNumber(total)}</p>
          {dealerKnown ? (
            <p className="mt-2 text-xs text-[#718075]">
              Priced from the dealer&apos;s own price list, falling back to the standard dealer price and then the
              catalogue. This is the total the order will be charged at.
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
