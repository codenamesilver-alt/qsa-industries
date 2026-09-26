"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { businessDate } from "../lib/format";
import { createClient } from "../lib/supabase/client";
import type { ProductRow } from "../lib/data";

type MaterialOption = {
  id: string;
  product_id: string;
  name: string;
  unit: string;
};

type MaterialRow = {
  productId: string;
  quantity: string;
};

export function ProductionRunForm({
  products,
  rawMaterials,
}: {
  products: ProductRow[];
  rawMaterials: MaterialOption[];
}) {
  const router = useRouter();
  const finishedProducts = products.filter((product) => product.is_sellable);
  const [productId, setProductId] = useState(finishedProducts[0]?.id ?? "");
  const [runDate, setRunDate] = useState(businessDate());
  const [shift, setShift] = useState("morning");
  const [quantity, setQuantity] = useState("");
  const [qcStatus, setQcStatus] = useState("pending");
  const [qcNotes, setQcNotes] = useState("");
  const [materials, setMaterials] = useState<MaterialRow[]>([
    { productId: rawMaterials[0]?.product_id ?? "", quantity: "" },
  ]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const hasValidMaterials = materials.some((row) => {
    const value = Number(row.quantity);
    return Boolean(row.productId) && Number.isFinite(value) && value > 0;
  });

  function updateMaterial(index: number, field: keyof MaterialRow, value: string) {
    setMaterials((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)));
  }

  function addMaterial() {
    setMaterials((current) => [...current, { productId: rawMaterials[0]?.product_id ?? "", quantity: "" }]);
  }

  function removeMaterial(index: number) {
    setMaterials((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const materialRows = materials
      .filter((row) => row.productId && row.quantity)
      .map((row) => ({ product_id: row.productId, quantity: Number(row.quantity) }));
    const outputValue = Number(quantity);
    if (!productId || !Number.isFinite(outputValue) || outputValue <= 0) {
      setMessage("Enter a valid finished product and output quantity.");
      return;
    }
    if (!materialRows.length || materialRows.some((row) => !Number.isFinite(row.quantity) || row.quantity <= 0)) {
      setMessage("Add at least one raw material with a positive quantity.");
      return;
    }
    if (qcStatus === "failed" && !qcNotes.trim()) {
      setMessage("Failed QC requires notes.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("create_production_run", {
      target_product_id: productId,
       output_quantity: outputValue,
      run_shift: shift,
      run_date_value: runDate,
      material_rows: materialRows,
      qc_status_value: qcStatus,
      qc_notes_value: qcNotes,
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setQuantity("");
    setQcNotes("");
    setMessage("Production run recorded. Raw materials were consumed; passed QC also added finished-goods stock.");
    router.refresh();
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="text-sm font-semibold text-[#334536]">
          Finished product
          <select
            className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
            onChange={(event) => setProductId(event.target.value)}
            value={productId}
          >
            {finishedProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {product.sku} · {product.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Run date
          <input
            className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
            onChange={(event) => setRunDate(event.target.value)}
            required
            type="date"
            value={runDate}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Shift
          <select
            className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
            onChange={(event) => setShift(event.target.value)}
            value={shift}
          >
            <option value="morning">Morning</option>
            <option value="evening">Evening</option>
            <option value="night">Night</option>
          </select>
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">
          Output quantity
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
          QC status
          <select
            className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
            onChange={(event) => setQcStatus(event.target.value)}
            value={qcStatus}
          >
            <option value="pending">Pending</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>
        </label>
      </div>
      <label className="block text-sm font-semibold text-[#334536]">
        QC notes
        <textarea
          className="mt-2 min-h-24 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
           onChange={(event) => setQcNotes(event.target.value)}
           required={qcStatus === "failed"}
           value={qcNotes}
        />
      </label>
      <div>
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-semibold text-[#334536]">Raw materials consumed</p>
          <button
            className="rounded-full border border-[#d6e1ce] px-3 py-1.5 text-xs font-bold text-[#4f6254]"
            onClick={addMaterial}
            type="button"
          >
            Add material
          </button>
        </div>
        <div className="mt-3 space-y-3">
          {materials.map((material, index) => (
            <div className="grid gap-3 md:grid-cols-[1fr_0.4fr_auto]" key={`${index}-${material.productId}`}>
              <select
                className="rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm"
                onChange={(event) => updateMaterial(index, "productId", event.target.value)}
                value={material.productId}
              >
                {rawMaterials.map((option) => (
                  <option key={option.product_id} value={option.product_id}>
                    {option.name} · {option.unit}
                  </option>
                ))}
              </select>
              <input
                className="rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm"
                min="0.01"
                onChange={(event) => updateMaterial(index, "quantity", event.target.value)}
                placeholder="Quantity"
                step="0.01"
                type="number"
                value={material.quantity}
              />
              <button
                className="rounded-2xl border border-[#f2b8ad] px-4 py-3 text-sm font-bold text-[#a33a2b]"
                onClick={() => removeMaterial(index)}
                type="button"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
      {message ? <p className="rounded-2xl bg-[#eef6df] px-4 py-3 text-sm text-[#4e741d]">{message}</p> : null}
      <button
        className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
         disabled={loading || !productId || !quantity || !hasValidMaterials || (qcStatus === "failed" && !qcNotes.trim())}
        type="submit"
      >
        {loading ? "Saving…" : "Record production run"}
      </button>
    </form>
  );
}
