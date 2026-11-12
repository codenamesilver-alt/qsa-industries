"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ProductRow } from "../lib/data";
import { businessDate } from "../lib/format";
import { PdfHelp } from "./pdf-help";

// receive_into_batch takes a stock_movement_source, and the function itself
// refuses 'sales' because a batch is stock arriving rather than stock leaving.
// The option list matches the function's own allow-list rather than the enum, so
// the form cannot offer a choice the database will reject.
const SOURCES = [
  { value: "production", label: "Production output" },
  { value: "purchase", label: "Purchase receipt" },
  { value: "adjustment", label: "Stock adjustment" },
  { value: "opening_balance", label: "Opening balance" },
] as const;

export function BatchReceiveForm({ products }: { products: ProductRow[] }) {
  const router = useRouter();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [batchCode, setBatchCode] = useState("");
  const [manufactureDate, setManufactureDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [quantity, setQuantity] = useState("");
  const [source, setSource] = useState<(typeof SOURCES)[number]["value"]>("purchase");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const quantityValue = Number(quantity);
  const quantityValid = quantity.trim() !== "" && Number.isFinite(quantityValue) && quantityValue > 0;
  // The function checks the same pair, and a form that submits manufacture after
  // expiry to get a database error message back is a worse experience than one
  // that will not submit it.
  const datesOrdered = !manufactureDate || !expiryDate || manufactureDate <= expiryDate;
  const canSubmit = Boolean(productId) && batchCode.trim() !== "" && Boolean(expiryDate) && quantityValid && datesOrdered;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage("");
    setFailed(false);
    setLoading(true);
    const res = await fetch("/api/batches/receive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p_product_id: productId, p_batch_code: batchCode.trim(), p_manufacture_date: manufactureDate || null, p_expiry_date: expiryDate, p_quantity: Number(quantity), p_source: source, p_reference_id: null, p_reason: reason.trim() || null }) });
    const json = await res.json();
    const error = res.ok ? null : { message: json.error ?? "Failed" };
    setLoading(false);
    if (error) {
      setMessage(error.message);
      setFailed(true);
      return;
    }
    setBatchCode("");
    setManufactureDate("");
    setExpiryDate("");
    setQuantity("");
    setReason("");
    setMessage("Batch received. Dispatch will draw it down in expiry order.");
    router.refresh();
  }

  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit}>
      <div className="flex justify-end"><PdfHelp guide="11-batch-receive" /></div>
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
        Batch code
        <input
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
          onChange={(event) => setBatchCode(event.target.value)}
          placeholder="e.g. LOT-2026-004"
          required
          value={batchCode}
        />
      </label>
      <label className="text-sm font-semibold text-[#334536]">
        Manufacture date
        <input
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
          max={businessDate()}
          onChange={(event) => setManufactureDate(event.target.value)}
          type="date"
          value={manufactureDate}
        />
      </label>
      <label className="text-sm font-semibold text-[#334536]">
        Expiry date
        <input
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
          min={businessDate()}
          onChange={(event) => setExpiryDate(event.target.value)}
          required
          type="date"
          value={expiryDate}
        />
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
        Source
        <select
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
          onChange={(event) => setSource(event.target.value as (typeof SOURCES)[number]["value"])}
          value={source}
        >
          {SOURCES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-semibold text-[#334536] md:col-span-2">
        Reason
        <input
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
          onChange={(event) => setReason(event.target.value)}
          placeholder="Optional note carried into the movement log"
          value={reason}
        />
      </label>
      {!datesOrdered ? (
        <p className="rounded-2xl bg-[#fff0ed] px-4 py-3 text-sm text-[#a33a2b] md:col-span-2">
          Manufacture date is after the expiry date.
        </p>
      ) : null}
      <div className="md:col-span-2">
        {message ? (
          <p
            className={`mb-4 rounded-2xl px-4 py-3 text-sm ${
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
          {loading ? "Receiving…" : "Receive into batch"}
        </button>
      </div>
    </form>
  );
}
