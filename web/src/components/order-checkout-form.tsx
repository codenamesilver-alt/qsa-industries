"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import type { DealerCatalogRow } from "../lib/data";
import { formatNumber } from "../lib/format";

export function OrderCheckoutForm({ catalog }: { catalog: DealerCatalogRow[] }) {
  const router = useRouter();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const total = useMemo(
    () =>
      catalog.reduce((sum, product) => {
        const quantity = Number(quantities[product.product_id] ?? 0);
        return sum + quantity * Number(product.unit_price);
      }, 0),
    [catalog, quantities],
  );

  function setQuantity(productId: string, value: string) {
    setQuantities((current) => ({ ...current, [productId]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setLoading(true);
    const lines = catalog
      .filter((product) => Number(quantities[product.product_id] ?? 0) > 0)
      .map((product) => ({
        product_id: product.product_id,
        quantity: Number(quantities[product.product_id]),
      }));
    const supabase = createClient();
    const { error } = await supabase.rpc("create_dealer_order", { order_lines: lines });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setQuantities({});
    setMessage("Order submitted. Sales review is now pending.");
    router.refresh();
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
            <tr>
              <th className="pb-3 pr-4 font-bold">Product</th>
              <th className="pb-3 pr-4 font-bold">Available</th>
              <th className="pb-3 pr-4 font-bold">Your price</th>
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
                <td className="py-4 pr-4 font-semibold">₹{formatNumber(product.unit_price)}</td>
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
        </div>
        <button
          className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading || total <= 0}
          type="submit"
        >
          {loading ? "Submitting…" : "Submit order"}
        </button>
      </div>
      {message ? <p className="rounded-2xl bg-[#eef6df] px-4 py-3 text-sm text-[#4e741d]">{message}</p> : null}
    </form>
  );
}
