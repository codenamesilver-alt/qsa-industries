"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteButton({ endpoint, id, label = "Delete" }: { endpoint: string; id: string; label?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  async function del() {
    if (!confirm("Delete this record?")) return;
    setLoading(true);
    await fetch(endpoint, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setLoading(false);
    router.refresh();
  }
  return (
    <button className="rounded-lg border border-[#f2b8ad] px-2 py-1 text-xs font-bold text-[#a33a2b] disabled:opacity-60" disabled={loading} onClick={del} type="button">
      {loading ? "…" : label}
    </button>
  );
}
