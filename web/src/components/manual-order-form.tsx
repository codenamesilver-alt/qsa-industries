"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PdfHelp } from "./pdf-help";

type Product = { id: string; name: string; sku: string; price: number | string };

type Line = { product_id: string; quantity: string; unit_price: string };

export function ManualOrderForm({ dealers, products }: { dealers: { id: string; name: string }[]; products: Product[] }) {
  const router = useRouter();
  const [dealerId, setDealerId] = useState("");
  const [status, setStatus] = useState("approved");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [lines, setLines] = useState<Line[]>([{ product_id: "", quantity: "1", unit_price: "" }]);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { product_id: "", quantity: "1", unit_price: "" }]);
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setFailed(false);
    const payload = {
      dealer_id: dealerId,
      status,
      requested_delivery_date: deliveryDate || null,
      lines: lines.map((l) => ({
        product_id: l.product_id,
        quantity: Number(l.quantity),
        unit_price: Number(l.unit_price),
      })),
    };
    const res = await fetch("/api/orders/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setFailed(true);
      setMessage(json.error ?? "Failed");
      return;
    }
    setMessage("Manual sales order created.");
    setLines([{ product_id: "", quantity: "1", unit_price: "" }]);
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="flex justify-end">
        <PdfHelp guide="28-manual-sales-orders" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-semibold text-[#334536]">
          Dealer
          <select className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" onChange={(e) => setDealerId(e.target.value)} required value={dealerId}>
            <option value="">Select dealer</option>
            {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Status
          <select className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" onChange={(e) => setStatus(e.target.value)} value={status}>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="dispatched">Dispatched</option>
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Requested delivery date
          <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" onChange={(e) => setDeliveryDate(e.target.value)} type="date" value={deliveryDate} />
        </label>
      </div>

      <div className="space-y-3">
        {lines.map((line, i) => (
          <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto]" key={i}>
            <select className="rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" onChange={(e) => updateLine(i, { product_id: e.target.value })} required value={line.product_id}>
              <option value="">Product</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
            </select>
            <input className="rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" min="0.01" onChange={(e) => updateLine(i, { quantity: e.target.value })} placeholder="Qty" required step="0.01" type="number" value={line.quantity} />
            <input className="rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" min="0" onChange={(e) => updateLine(i, { unit_price: e.target.value })} placeholder="Unit price" required step="0.01" type="number" value={line.unit_price} />
            <button className="rounded-xl border border-[#d6e1ce] px-3 py-2 text-xs font-bold text-[#a33a2b]" onClick={() => removeLine(i)} type="button">Remove</button>
          </div>
        ))}
        <button className="rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-xs font-bold text-[#4f6254]" onClick={addLine} type="button">Add line</button>
      </div>

      {message ? <p className={`rounded-2xl px-4 py-3 text-sm ${failed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"}`}>{message}</p> : null}
      <button className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:opacity-60" disabled={loading} type="submit">
        {loading ? "Creating…" : "Create manual sales order"}
      </button>
    </form>
  );
}
