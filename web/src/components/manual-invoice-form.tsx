"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PdfHelp } from "./pdf-help";

export function ManualInvoiceForm({ dealers }: { dealers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [dealerId, setDealerId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [taxable, setTaxable] = useState("");
  const [gst, setGst] = useState("");
  const [total, setTotal] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setFailed(false);
    const payload = {
      dealer_id: dealerId,
      invoice_number: invoiceNumber || null,
      invoice_date: invoiceDate || null,
      taxable_amount: Number(taxable),
      gst_amount: Number(gst),
      total_amount: Number(total),
    };
    const res = await fetch("/api/invoices/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setFailed(true);
      setMessage(json.error ?? "Failed");
      return;
    }
    setMessage(`Invoice ${json.data.invoice_number} created.`);
    setTaxable("");
    setGst("");
    setTotal("");
    setInvoiceNumber("");
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="flex justify-end">
        <PdfHelp guide="29-manual-invoices" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">
          Dealer
          <select className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" onChange={(e) => setDealerId(e.target.value)} required value={dealerId}>
            <option value="">Select dealer</option>
            {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Invoice number (optional)
          <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Auto-generated if blank" value={invoiceNumber} />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Invoice date
          <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" onChange={(e) => setInvoiceDate(e.target.value)} type="date" value={invoiceDate} />
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
      </div>

      {message ? <p className={`rounded-2xl px-4 py-3 text-sm ${failed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"}`}>{message}</p> : null}
      <button className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:opacity-60" disabled={loading} type="submit">
        {loading ? "Creating…" : "Create manual invoice"}
      </button>
    </form>
  );
}
