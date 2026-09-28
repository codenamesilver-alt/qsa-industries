"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import type { AdminProductRow } from "../lib/data";

type Props = {
  product: AdminProductRow | null;
};

// Writes through public.admin_upsert_product, not a table update. 20260926100600
// gave authenticated a column grant on products for the reorder threshold alone,
// so a direct .update() here could only ever change one of the nine fields on
// this form; the function is what lets one call carry the whole row and what
// keeps price, is_sellable and hsn_code out of reach of every other role.
export function AdminProductForm({ product }: Props) {
  const router = useRouter();
  const [sku, setSku] = useState(product?.sku ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [unit, setUnit] = useState(product?.unit_of_measure ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [hsn, setHsn] = useState(product?.hsn_code ?? "");
  const [threshold, setThreshold] = useState(product ? String(product.low_stock_threshold) : "0");
  const [sellable, setSellable] = useState(product?.is_sellable ?? true);
  const [active, setActive] = useState(product?.active ?? true);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const priceValue = Number(price);
  const thresholdValue = Number(threshold);
  // The HSN check mirrors products_hsn_code_format: four digits, then optionally
  // two more, then optionally two more. Checking here only saves a round trip;
  // the database still holds the constraint.
  const hsnOk = /^[0-9]{4}([0-9]{2})?([0-9]{2})?$/.test(hsn.trim());
  const canSubmit =
    sku.trim() !== "" &&
    name.trim() !== "" &&
    category.trim() !== "" &&
    unit.trim() !== "" &&
    hsnOk &&
    Number.isFinite(priceValue) &&
    priceValue >= 0 &&
    Number.isFinite(thresholdValue) &&
    thresholdValue >= 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage("");
    setFailed(false);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_upsert_product", {
      p_sku: sku.trim(),
      p_name: name.trim(),
      p_category: category.trim(),
      p_unit_of_measure: unit.trim(),
      p_price: priceValue,
      p_hsn_code: hsn.trim(),
      p_product_id: product?.id ?? null,
      p_low_stock_threshold: thresholdValue,
      p_is_sellable: sellable,
      p_active: active,
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      setFailed(true);
      return;
    }
    setMessage(product ? "Product updated." : "Product created.");
    if (!product) {
      setSku("");
      setName("");
      setCategory("");
      setUnit("");
      setPrice("");
      setHsn("");
      setThreshold("0");
    }
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">
          SKU
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setSku(event.target.value)}
            placeholder="QSA-BROILER-01"
            value={sku}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Name
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Category
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setCategory(event.target.value)}
            placeholder="e.g. Poultry"
            value={category}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Unit of measure
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setUnit(event.target.value)}
            placeholder="e.g. kg"
            value={unit}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          List price
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            min="0"
            onChange={(event) => setPrice(event.target.value)}
            step="0.01"
            type="number"
            value={price}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          HSN code
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            inputMode="numeric"
            onChange={(event) => setHsn(event.target.value)}
            placeholder="4, 6 or 8 digits"
            value={hsn}
          />
          {!hsnOk ? <span className="mt-2 block text-xs font-normal text-[#a33a2b]">Four, six or eight digits.</span> : null}
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Low stock threshold
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            min="0"
            onChange={(event) => setThreshold(event.target.value)}
            step="0.01"
            type="number"
            value={threshold}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm text-[#334536]">
          <input checked={sellable} onChange={(event) => setSellable(event.target.checked)} type="checkbox" />
          Sellable to dealers
        </label>
        <label className="flex items-center gap-2 text-sm text-[#334536]">
          <input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" />
          Active
        </label>
      </div>
      <p className="text-xs text-[#5d6b60]">
        Inactive keeps the product out of the dealer catalogue. Issued documents are unaffected: order and
        invoice lines snapshot the price they were raised at, so editing it here never rewrites history.
      </p>

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
        {loading ? "Saving…" : product ? "Save product" : "Create product"}
      </button>
    </form>
  );
}
