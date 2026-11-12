"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function GenerateSlipsButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  async function gen() {
    setLoading(true);
    setMsg("");
    const res = await fetch("/api/payslips/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payroll_run_id: runId }) });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) { setMsg(json.error ?? "Failed"); return; }
    setMsg(`Generated ${json.data.count} slips.`);
    router.refresh();
  }
  return (
    <div>
      <button className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:opacity-60" disabled={loading} onClick={gen} type="button">
        {loading ? "Generating…" : "Generate salary slips for this run"}
      </button>
      {msg ? <p className="mt-2 text-sm text-[#4e741d]">{msg}</p> : null}
    </div>
  );
}
