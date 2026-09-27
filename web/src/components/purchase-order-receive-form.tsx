"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import type { PurchaseOrderRow } from "../lib/data";
import { formatNumber } from "../lib/format";

// receive_purchase_order takes line ids, not product ids, and refuses a receipt
// larger than the open quantity on that line. Both are enforced again in the
// database, so this only avoids submitting a request that is certain to fail.
export function PurchaseOrderReceiveForm({ order }: { order: PurchaseOrderRow }) {
  const router = useRouter();
  const lines = order.purchase_order_lines ?? [];
  const openLines = lines.filter((line) => Number(line.quantity) - Number(line.quantity_received) > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const receipts = openLines
    .map((line) => ({ line, quantity: Number(quantities[line.id] ?? 0) }))
    .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0);

  const withinOpenQuantity = receipts.every(
    (entry) => entry.quantity <= Number(entry.line.quantity) - Number(entry.line.quantity_received),
  );
  const canSubmit = receipts.length > 0 && withinOpenQuantity;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage("");
    setFailed(false);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("receive_purchase_order", {
      p_purchase_order_id: order.id,
      p_lines: receipts.map((entry) => ({ line_id: entry.line.id, quantity: entry.quantity })),
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      setFailed(true);
      return;
    }
    setQuantities({});
    setMessage(`Stock received against ${order.po_number}.`);
    router.refresh();
  }

  if (!openLines.length) {
    return <p className="text-sm text-[#718075]">Every line on this purchase order is fully received.</p>;
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-3">
        {openLines.map((line) => {
          const open = Number(line.quantity) - Number(line.quantity_received);
          return (
            <div className="grid gap-3 md:grid-cols-[1.3fr_0.7fr_0.7fr]" key={line.id}>
              <div>
                <p className="font-semibold">{line.products?.name ?? "Material"}</p>
                <p className="mt-1 text-xs text-[#819083]">{line.products?.sku ?? line.product_id}</p>
              </div>
              <p className="self-center text-sm text-[#5d6b60]">
                Ordered {formatNumber(line.quantity)} · Received {formatNumber(line.quantity_received)}
              </p>
              <label className="text-sm font-semibold text-[#334536]">
                Receive now
                <input
                  className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
                  max={open}
                  min="0"
                  onChange={(event) =>
                    setQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                  }
                  step="0.01"
                  type="number"
                  value={quantities[line.id] ?? ""}
                />
              </label>
            </div>
          );
        })}
      </div>
      {!withinOpenQuantity ? (
        <p className="rounded-2xl bg-[#fff0ed] px-4 py-3 text-sm text-[#a33a2b]">
          A receipt exceeds what is still outstanding on that line.
        </p>
      ) : null}
      {message ? (
        <p
          className={`rounded-2xl px-4 py-3 text-sm ${
            failed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"
          }`}
        >
          {message}
        </p>
      ) : null}
      <button
        className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={loading || !canSubmit}
        type="submit"
      >
        {loading ? "Receiving…" : "Receive stock"}
      </button>
    </form>
  );
}
