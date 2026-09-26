"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import type { ProductionRunRow } from "../lib/data";

export function ProductionQcActions({
  runs,
  currentUserId,
  role,
}: {
  runs: ProductionRunRow[];
  currentUserId: string;
  role: string;
}) {
  const router = useRouter();
  const editableRuns = runs.filter((run) => role === "admin" || run.created_by === currentUserId);
  const [runId, setRunId] = useState(editableRuns[0]?.id ?? "");
  const [qcStatus, setQcStatus] = useState<ProductionRunRow["qc_status"]>(editableRuns[0]?.qc_status ?? "pending");
  const [qcNotes, setQcNotes] = useState(editableRuns[0]?.qc_notes ?? "");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  function selectRun(id: string) {
    setRunId(id);
    const run = editableRuns.find((candidate) => candidate.id === id);
    setQcStatus(run?.qc_status ?? "pending");
    setQcNotes(run?.qc_notes ?? "");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runId) return;
    setLoading(true);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase
      .from("production_runs")
      .update({ qc_status: qcStatus, qc_notes: qcNotes || null })
      .eq("id", runId);
    setLoading(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("QC status updated.");
    router.refresh();
  }

  if (!editableRuns.length) {
    return <p className="text-sm text-[#718075]">No editable production runs.</p>;
  }

  const selectedRun = editableRuns.find((run) => run.id === runId);
  const canChangeQc = selectedRun?.qc_status === "pending";

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block text-sm font-semibold text-[#334536]">
        Production run
        <select
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
          onChange={(event) => selectRun(event.target.value)}
          value={runId}
        >
          {editableRuns.map((run) => (
            <option key={run.id} value={run.id}>
              {run.run_date} · {run.products?.sku ?? run.product_id} · {run.quantity_produced} {run.shift}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">
          QC status
          <select
            className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canChangeQc}
            onChange={(event) => setQcStatus(event.target.value as ProductionRunRow["qc_status"])}
            value={qcStatus}
          >
            <option value="pending">Pending</option>
            <option value="passed">Passed</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          QC notes
          <input
            className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
            onChange={(event) => setQcNotes(event.target.value)}
            required={qcStatus === "failed"}
            value={qcNotes}
          />
        </label>
      </div>
      {message ? <p className="rounded-2xl bg-[#eef6df] px-4 py-3 text-sm text-[#4e741d]">{message}</p> : null}
      <button
        className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={loading || !runId}
        type="submit"
      >
        {loading ? "Saving…" : "Save QC status"}
      </button>
    </form>
  );
}
