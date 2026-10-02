"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { businessDate } from "../lib/format";
import { createClient } from "../lib/supabase/client";

export function GenerateInvoiceButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  // Success and failure shared one red element, so a generated invoice was
  // displayed as a failure. Track which one this is instead.
  const [failed, setFailed] = useState(false);

  async function generateInvoice() {
    setLoading(true);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.rpc("generate_invoice", { target_order_id: orderId });
    setLoading(false);
    if (error) {
      setFailed(true);
      setMessage(error.message);
      return;
    }
    setFailed(false);
    setMessage("Invoice generated.");
    router.refresh();
  }

  return (
    <div>
      <button
        className="rounded-xl bg-[#15221b] px-3 py-2 text-xs font-bold text-[#d8f35b] disabled:opacity-60"
        disabled={loading}
        onClick={generateInvoice}
        type="button"
      >
        {loading ? "Generating…" : "Generate invoice"}
      </button>
      {message ? (
        <p className={`mt-2 max-w-xs text-xs ${failed ? "text-[#a33a2b]" : "text-[#4e741d]"}`}>{message}</p>
      ) : null}
    </div>
  );
}

export function DealerPaymentForm({ dealerId }: { dealerId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const amountValue = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(amountValue) && amountValue > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!amountValid) {
      setFailed(true);
      setMessage("Enter a positive payment amount.");
      return;
    }
    setLoading(true);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.rpc("record_dealer_payment", {
      target_dealer_id: dealerId,
      payment_amount: Number(amount),
      payment_date_value: businessDate(),
      payment_mode_value: mode,
      payment_reference: reference || null,
    });
    setLoading(false);
    if (error) {
      setFailed(true);
      setMessage(error.message);
      return;
    }
    setAmount("");
    setReference("");
    setFailed(false);
    setMessage("Dealer payment recorded.");
    router.refresh();
  }

  return (
    <form className="grid gap-2 md:grid-cols-[0.7fr_1fr_1fr_auto]" onSubmit={handleSubmit}>
      <input
        className="rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm"
        min="0.01"
        onChange={(event) => setAmount(event.target.value)}
        placeholder="Amount"
        required
        step="0.01"
        type="number"
        value={amount}
      />
      <select className="rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm" onChange={(event) => setMode(event.target.value)} value={mode}>
        <option value="bank_transfer">Bank transfer</option>
        <option value="cash">Cash</option>
        <option value="upi">UPI</option>
        <option value="cheque">Cheque</option>
        <option value="other">Other</option>
      </select>
      <input
        className="rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm"
        onChange={(event) => setReference(event.target.value)}
        placeholder="Reference"
        value={reference}
      />
      <button className="rounded-xl bg-[#eef6df] px-3 py-2 text-xs font-bold text-[#4e741d] disabled:opacity-60" disabled={loading || !amountValid} type="submit">
        {loading ? "Saving…" : "Record"}
      </button>
      {message ? (
        <p className={`text-xs md:col-span-4 ${failed ? "text-[#a33a2b]" : "text-[#4e741d]"}`}>{message}</p>
      ) : null}
    </form>
  );
}

export function PaymentForm({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const amountValue = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isFinite(amountValue) && amountValue > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!amountValid) {
      setFailed(true);
      setMessage("Enter a positive payment amount.");
      return;
    }
    setLoading(true);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.rpc("record_invoice_payment", {
      target_invoice_id: invoiceId,
      payment_amount: Number(amount),
      payment_date_value: businessDate(),
      payment_mode_value: mode,
      payment_reference: reference || null,
    });
    setLoading(false);
    if (error) {
      setFailed(true);
      setMessage(error.message);
      return;
    }
    setAmount("");
    setReference("");
    setFailed(false);
    setMessage("Payment recorded.");
    router.refresh();
  }

  return (
    <form className="grid gap-2 md:grid-cols-[0.7fr_1fr_1fr_auto]" onSubmit={handleSubmit}>
      <input
        className="rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm"
        min="0.01"
        onChange={(event) => setAmount(event.target.value)}
        placeholder="Amount"
        required
        step="0.01"
        type="number"
        value={amount}
      />
      <select className="rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm" onChange={(event) => setMode(event.target.value)} value={mode}>
        <option value="bank_transfer">Bank transfer</option>
        <option value="cash">Cash</option>
        <option value="upi">UPI</option>
        <option value="cheque">Cheque</option>
        <option value="other">Other</option>
      </select>
      <input
        className="rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm"
        onChange={(event) => setReference(event.target.value)}
        placeholder="Reference"
        value={reference}
      />
      <button className="rounded-xl bg-[#eef6df] px-3 py-2 text-xs font-bold text-[#4e741d] disabled:opacity-60" disabled={loading || !amountValid} type="submit">
        {loading ? "Saving…" : "Record"}
      </button>
      {message ? (
        <p className={`text-xs md:col-span-4 ${failed ? "text-[#a33a2b]" : "text-[#4e741d]"}`}>{message}</p>
      ) : null}
    </form>
  );
}
