"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { businessDate } from "../lib/format";
import type { UserRole } from "../lib/auth";

export function OrderActions({
  orderId,
  status,
  role,
}: {
  orderId: string;
  status: string;
  role: UserRole;
}) {
  const router = useRouter();
  const [remark, setRemark] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState("");

  async function run(action: string) {
    setMessage("");
    setLoading(action);
    let error: { message: string } | null = null;
    const today = businessDate();

    const res = await fetch(`/api/orders/${orderId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        dispatch_date_value: today,
        dispatch_note: remark || null,
        approval_remark: remark || null,
        rejection_remark: remark,
      }),
    });
    const json = await res.json();
    if (!res.ok) error = { message: json.error ?? "Failed" };

    setLoading("");
    if (error) {
      setMessage(error.message);
      return;
    }
    setRemark("");
    setMessage("Order updated.");
    router.refresh();
  }

  const canApprove = role === "admin" || role === "sales_manager" || role === "sales_director";
  const canDirector = role === "admin" || role === "sales_director";
  const canDispatch = role === "admin" || role === "logistics";
  const showApproval = status === "pending" && canApprove;
  const showEscalation = status === "pending" && canApprove;
  const showDirector = status === "pending_director_approval" && canDirector;
  const showDispatch = status === "approved" && canDispatch;

  if (!showApproval && !showEscalation && !showDirector && !showDispatch) return null;

  return (
    <div className="mt-5 border-t border-[#e8ede6] pt-5">
      <input
        className="w-full rounded-2xl border border-[#d6e1ce] px-4 py-3 text-sm"
        onChange={(event) => setRemark(event.target.value)}
        placeholder="Remark required for override, escalation, rejection, or dispatch note"
        value={remark}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        {showApproval ? (
          <>
            <ActionButton label={loading === "approve" ? "Approving…" : "Approve"} onClick={() => run("approve")} />
            <ActionButton label={loading === "override" ? "Overriding…" : "Override with remark"} onClick={() => run("override")} tone="warning" />
          </>
        ) : null}
        {showEscalation ? <ActionButton label="Escalate" onClick={() => run("escalate")} tone="muted" /> : null}
        {showDirector ? (
          <>
            <ActionButton label="Approve" onClick={() => run("director_approve")} />
            <ActionButton label="Reject" onClick={() => run("director_reject")} tone="danger" />
          </>
        ) : null}
        {showDispatch ? <ActionButton label="Mark dispatched" onClick={() => run("dispatch")} tone="blue" /> : null}
      </div>
      {message ? <p className="mt-3 text-sm text-[#a33a2b]">{message}</p> : null}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  tone = "primary",
}: {
  label: string;
  onClick: () => void;
  tone?: "primary" | "warning" | "danger" | "muted" | "blue";
}) {
  const toneClass = {
    primary: "bg-[#15221b] text-[#d8f35b]",
    warning: "bg-[#fff7df] text-[#8b6412]",
    danger: "bg-[#fff0ed] text-[#a33a2b]",
    muted: "bg-[#eef2eb] text-[#4f6254]",
    blue: "bg-[#e8f7f8] text-[#276c76]",
  }[tone];
  return (
    <button className={`rounded-xl px-4 py-2 text-xs font-bold ${toneClass}`} onClick={onClick} type="button">
      {label}
    </button>
  );
}
