"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PdfHelp } from "./pdf-help";

type Product = { id: string; name: string; sku: string };

export function PurchaseInvoiceForm({ products, pos }: { products: Product[]; pos: { id: string; po_number: string }[] }) {
  const router = useRouter();
  const [supplier, setSupplier] = useState("");
  const [poId, setPoId] = useState("");
  const [invNum, setInvNum] = useState("");
  const [invDate, setInvDate] = useState("");
  const [taxable, setTaxable] = useState("");
  const [gst, setGst] = useState("");
  const [total, setTotal] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ product_id: "", quantity: "1", unit_price: "" }]);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  function updateLine(i: number, patch: any) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setFailed(false);
    const payload = {
      supplier_name: supplier,
      invoice_number: invNum,
      invoice_date: invDate || null,
      po_id: poId || null,
      taxable_amount: Number(taxable),
      gst_amount: Number(gst),
      total_amount: Number(total),
      notes: notes || null,
      lines: lines.map((l) => ({ product_id: l.product_id, quantity: Number(l.quantity), unit_price: Number(l.unit_price) })),
    };
    const res = await fetch("/api/purchase-invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setFailed(true);
      setMessage(json.error ?? "Failed");
      return;
    }
    setMessage("Purchase invoice recorded.");
    setSupplier("");
    setInvNum("");
    setTaxable("");
    setGst("");
    setTotal("");
    setLines([{ product_id: "", quantity: "1", unit_price: "" }]);
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="flex justify-end">
        <PdfHelp guide="30-purchase-invoices" />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-semibold text-[#334536]">
          Supplier name
          <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" onChange={(e) => setSupplier(e.target.value)} required value={supplier} />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Invoice number
          <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" onChange={(e) => setInvNum(e.target.value)} required value={invNum} />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Invoice date
          <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" onChange={(e) => setInvDate(e.target.value)} type="date" value={invDate} />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Link to PO (optional)
          <select className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" onChange={(e) => setPoId(e.target.value)} value={poId}>
            <option value="">None</option>
            {pos.map((p) => <option key={p.id} value={p.id}>{p.po_number}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Taxable amount
          <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" min="0" onChange={(e) => setTaxable(e.target.value)} required step="0.01" type="number" value={taxable} />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          GST amount
          <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" min="0" onChange={(e) => setGst(e.target.value)} required step="0.01" type="number" value={gst} />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Total amount
          <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" min="0" onChange={(e) => setTotal(e.target.value)} required step="0.01" type="number" value={total} />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Notes
          <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" onChange={(e) => setNotes(e.target.value)} value={notes} />
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
            <button className="rounded-xl border border-[#d6e1ce] px-3 py-2 text-xs font-bold text-[#a33a2b]" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} type="button">Remove</button>
          </div>
        ))}
        <button className="rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-xs font-bold text-[#4f6254]" onClick={() => setLines((prev) => [...prev, { product_id: "", quantity: "1", unit_price: "" }])} type="button">Add line</button>
      </div>

      {message ? <p className={`rounded-2xl px-4 py-3 text-sm ${failed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"}`}>{message}</p> : null}
      <button className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:opacity-60" disabled={loading} type="submit">
        {loading ? "Recording…" : "Record purchase invoice"}
      </button>
    </form>
  );
}
