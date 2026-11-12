"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PdfHelp } from "./pdf-help";

type Props = {
  orderId: string;
  orderReference: string;
};

// One function, one question. mark_order_delivered is refused before dispatch and
// refused twice for the same order, and the only roles that can call it are
// logistics and admin: nobody else is permitted to state that goods arrived. The
// note is where "2 of 12 cartons short" goes, which is the part that is not
// derivable from the order.
export function DeliveryConfirmForm({ orderId, orderReference }: Props) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  async function confirm() {
    setMessage("");
    setFailed(false);
    setLoading(true);
    const res = await fetch(`/api/orders/${orderId}/deliver`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ p_note: note.trim() || null }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setMessage(json.error ?? "Failed");
      setFailed(true);
      return;
    }
    setNote("");
    setMessage(`Delivery confirmed for ${orderReference}.`);
    router.refresh();
  }

  return (
    <div className="border-t border-[#e8ede6] pt-5">
      <label className="block text-sm font-semibold text-[#334536]">
        Delivery note
        <input
          className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
          onChange={(event) => setNote(event.target.value)}
          placeholder="Who signed, what was short, where it was left"
          value={note}
        />
      </label>
      <button
        className="mt-3 rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={loading}
        onClick={confirm}
        type="button"
      >
        {loading ? "Confirming…" : "Confirm delivery"}
      </button>
      {message ? (
        <p
          className={`mt-3 rounded-2xl px-4 py-3 text-sm ${
            failed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
