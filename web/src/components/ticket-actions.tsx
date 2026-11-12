"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function TicketActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  async function act(action: string, reason?: string) {
    setLoading(true);
    setMsg("");
    const res = await fetch("/api/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ticket_id: id, reason }) });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) { setMsg(json.error ?? "Failed"); return; }
    router.refresh();
  }

  const canApprove = status === "pending_approval";
  const canCancel = !["resolved", "closed", "cancelled"].includes(status);

  return (
    <div className="flex flex-wrap gap-1">
      {canApprove ? (
        <>
          <button className="rounded-lg bg-[#6f8c3b] px-2 py-1 text-xs font-bold text-white disabled:opacity-60" disabled={loading} onClick={() => act("approve")} type="button">Approve</button>
          <button className="rounded-lg bg-[#a33a2b] px-2 py-1 text-xs font-bold text-white disabled:opacity-60" disabled={loading} onClick={() => { const r = prompt("Denial reason:"); if (r) act("deny", r); }} type="button">Deny</button>
        </>
      ) : null}
      {status === "approved" || status === "open" ? (
        <button className="rounded-lg bg-[#276c76] px-2 py-1 text-xs font-bold text-white disabled:opacity-60" disabled={loading} onClick={() => act("start")} type="button">Start</button>
      ) : null}
      {status === "in_progress" ? (
        <button className="rounded-lg bg-[#6f8c3b] px-2 py-1 text-xs font-bold text-white disabled:opacity-60" disabled={loading} onClick={() => act("resolve")} type="button">Resolve</button>
      ) : null}
      {status === "resolved" ? (
        <button className="rounded-lg bg-[#8b6412] px-2 py-1 text-xs font-bold text-white disabled:opacity-60" disabled={loading} onClick={() => act("close")} type="button">Close</button>
      ) : null}
      {canCancel ? (
        <button className="rounded-lg border border-[#f2b8ad] px-2 py-1 text-xs font-bold text-[#a33a2b] disabled:opacity-60" disabled={loading} onClick={() => { const r = prompt("Cancel reason:"); if (r) act("cancel", r); }} type="button">Cancel</button>
      ) : null}
      {msg ? <span className="text-xs text-[#a33a2b]">{msg}</span> : null}
    </div>
  );
}
