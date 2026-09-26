"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import type { ProductRow } from "../lib/data";

export function StockAdjustmentForm({ products }: { products: ProductRow[] }) {
  const router = useRouter();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [movementType, setMovementType] = useState<"in" | "out">("in");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("create_stock_adjustment", {
      target_product_id: productId,
      adjustment_quantity: Number(quantity),
      adjustment_movement_type: movementType,
      adjustment_reason: reason,
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setQuantity("");
    setReason("");
    setMessage("Stock adjustment recorded.");
    router.refresh();
  }

  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
      <label className="text-sm font-semibold text-[#334536]">
        Product
        <select
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
          onChange={(event) => setProductId(event.target.value)}
          value={productId}
        >
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.sku} · {product.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-semibold text-[#334536]">
        Movement
        <select
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
          onChange={(event) => setMovementType(event.target.value as "in" | "out")}
          value={movementType}
        >
          <option value="in">Stock in</option>
          <option value="out">Stock out</option>
        </select>
      </label>
      <label className="text-sm font-semibold text-[#334536]">
        Quantity
        <input
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
          min="0.01"
          onChange={(event) => setQuantity(event.target.value)}
          required
          step="0.01"
          type="number"
          value={quantity}
        />
      </label>
      <label className="text-sm font-semibold text-[#334536]">
        Reason
        <input
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
          onChange={(event) => setReason(event.target.value)}
          required
          value={reason}
        />
      </label>
      <div className="md:col-span-2">
        {message ? <p className="mb-4 rounded-2xl bg-[#eef6df] px-4 py-3 text-sm text-[#4e741d]">{message}</p> : null}
        <button
          className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading || !productId}
          type="submit"
        >
          {loading ? "Saving…" : "Record adjustment"}
        </button>
      </div>
    </form>
  );
}
