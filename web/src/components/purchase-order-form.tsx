"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import type { ProductRow } from "../lib/data";
import { businessDate, formatNumber } from "../lib/format";

type LineDraft = { productId: string; quantity: string; unitPrice: string };

function emptyLine(products: ProductRow[]): LineDraft {
  return { productId: products[0]?.id ?? "", quantity: "", unitPrice: "" };
}

function lineTotal(line: LineDraft) {
  const quantity = Number(line.quantity);
  const price = Number(line.unitPrice);
  if (!Number.isFinite(quantity) || !Number.isFinite(price)) return 0;
  return quantity * price;
}

// create_purchase_order refuses any product that is sellable: a purchase order
// buys raw material to feed production, not finished goods to resell. The form
// therefore only ever offers the raw-material half of the catalogue.
export function PurchaseOrderForm({ products }: { products: ProductRow[] }) {
  const router = useRouter();
  const [supplierName, setSupplierName] = useState("");
  const [supplierGstin, setSupplierGstin] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine(products)]);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const total = useMemo(() => lines.reduce((sum, line) => sum + lineTotal(line), 0), [lines]);

  const usableLines = lines.filter(
    (line) => line.productId && Number(line.quantity) > 0 && line.unitPrice.trim() !== "" && Number(line.unitPrice) >= 0,
  );
  const noDuplicateProducts = new Set(lines.map((line) => line.productId)).size === lines.length;
  const pastExpected = Boolean(expectedDate) && expectedDate < businessDate();
  const canSubmit =
    supplierName.trim() !== "" &&
    usableLines.length > 0 &&
    usableLines.length === lines.length &&
    noDuplicateProducts &&
    !pastExpected;

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line, position) => (position === index ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [...current, emptyLine(products)]);
  }

  function removeLine(index: number) {
    setLines((current) => (current.length === 1 ? current : current.filter((_, position) => position !== index)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage("");
    setFailed(false);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("create_purchase_order", {
      p_supplier_name: supplierName.trim(),
      p_supplier_gstin: supplierGstin.trim() || null,
      p_expected_date: expectedDate || null,
      p_notes: notes.trim() || null,
      p_lines: usableLines.map((line) => ({
        product_id: line.productId,
        quantity: Number(line.quantity),
        unit_price: Number(line.unitPrice),
      })),
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      setFailed(true);
      return;
    }
    setSupplierName("");
    setSupplierGstin("");
    setExpectedDate("");
    setNotes("");
    setLines([emptyLine(products)]);
    setMessage("Purchase order raised.");
    router.refresh();
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="text-sm font-semibold text-[#334536]">
          Supplier
          <input
            className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
            onChange={(event) => setSupplierName(event.target.value)}
            required
            value={supplierName}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Supplier GSTIN
          <input
            className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
            onChange={(event) => setSupplierGstin(event.target.value.toUpperCase())}
            placeholder="Optional"
            value={supplierGstin}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Expected date
          <input
            className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
            min={businessDate()}
            onChange={(event) => setExpectedDate(event.target.value)}
            type="date"
            value={expectedDate}
          />
        </label>
      </div>
      <label className="block text-sm font-semibold text-[#334536]">
        Notes
        <input
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Optional"
          value={notes}
        />
      </label>

      <div className="space-y-3">
        {lines.map((line, index) => {
          const openToDuplicate = new Set(
            lines.filter((_, position) => position !== index).map((other) => other.productId),
          );
          return (
            <div className="grid gap-3 rounded-2xl border border-[#e8ede6] p-4 md:grid-cols-[1.4fr_0.7fr_0.7fr_auto]" key={index}>
              <label className="text-sm font-semibold text-[#334536]">
                Raw material
                <select
                  className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
                  onChange={(event) => updateLine(index, { productId: event.target.value })}
                  value={line.productId}
                >
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.sku} · {product.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-semibold text-[#334536]">
                Quantity
                <input
                  className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
                  min="0.01"
                  onChange={(event) => updateLine(index, { quantity: event.target.value })}
                  required
                  step="0.01"
                  type="number"
                  value={line.quantity}
                />
              </label>
              <label className="text-sm font-semibold text-[#334536]">
                Unit price
                <input
                  className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
                  min="0"
                  onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
                  required
                  step="0.01"
                  type="number"
                  value={line.unitPrice}
                />
              </label>
              <div className="flex items-end">
                <button
                  className="rounded-xl border border-[#d6e1ce] px-3 py-2 text-xs font-bold text-[#4f6254] disabled:opacity-40"
                  disabled={lines.length === 1}
                  onClick={() => removeLine(index)}
                  type="button"
                >
                  Remove
                </button>
              </div>
              {openToDuplicate.has(line.productId) ? (
                <p className="rounded-xl bg-[#fff0ed] px-3 py-2 text-xs text-[#a33a2b] md:col-span-4">
                  This material already has a line above. Combine the quantities into one line.
                </p>
              ) : null}
            </div>
          );
        })}
        <button
          className="rounded-xl border border-[#d6e1ce] bg-white px-4 py-2 text-xs font-bold text-[#4f6254]"
          onClick={addLine}
          type="button"
        >
          Add line
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#e8ede6] pt-5">
        <div>
          <p className="text-sm text-[#718075]">Order total</p>
          <p className="mt-1 text-3xl font-semibold tracking-[-0.05em]">₹{formatNumber(total)}</p>
        </div>
        <button
          className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading || !canSubmit}
          type="submit"
        >
          {loading ? "Raising…" : "Raise purchase order"}
        </button>
      </div>
      {pastExpected ? (
        <p className="rounded-2xl bg-[#fff0ed] px-4 py-3 text-sm text-[#a33a2b]">
          Expected date is in the past.
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
    </form>
  );
}
