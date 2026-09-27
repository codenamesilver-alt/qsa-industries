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
  // production_runs_update_internal is not an own-rows policy. Its row filter
  // reads: admin and qc_staff may update any run, and a production_manager may
  // update only a run they created. Filtering to "mine or admin" therefore hid
  // every run from a qc_staff user, who is precisely the person whose job is to
  // clear the pending queue someone else created.
  const seesEveryRun = role === "admin" || role === "qc_staff";
  const editableRuns = runs.filter((run) => seesEveryRun || run.created_by === currentUserId);
  const pendingCount = editableRuns.filter((run) => run.qc_status === "pending").length;
  const [runId, setRunId] = useState(editableRuns[0]?.id ?? "");
  const [qcStatus, setQcStatus] = useState<ProductionRunRow["qc_status"]>(editableRuns[0]?.qc_status ?? "pending");
  const [qcNotes, setQcNotes] = useState(editableRuns[0]?.qc_notes ?? "");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
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
    setFailed(false);
    const supabase = createClient();
    // Only the two QC columns are granted to authenticated, and the SELECT is
    // narrowed to them as well so a failure here is unambiguous: if the grant or
    // the RLS row filter is wrong, the update matches nothing or is refused
    // rather than silently editing a different column.
    const { error } = await supabase
      .from("production_runs")
      .update({ qc_status: qcStatus, qc_notes: qcNotes || null })
      .eq("id", runId)
      .select("id")
      .maybeSingle();
    setLoading(false);
    if (error) {
      setMessage(error.message);
      setFailed(true);
      return;
    }
    setMessage("QC status updated.");
    router.refresh();
  }

  if (!editableRuns.length) {
    return (
      <p className="text-sm text-[#718075]">
        {role === "production_manager"
          ? "No production runs of your own are available to record a verdict on."
          : "No production runs are available for a QC verdict."}
      </p>
    );
  }

  const selectedRun = editableRuns.find((run) => run.id === runId);
  const canChangeQc = selectedRun?.qc_status === "pending";

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <p className="rounded-2xl bg-[#f5f7f2] px-4 py-3 text-sm text-[#5d6b60]">
        {pendingCount} run{pendingCount === 1 ? "" : "s"} awaiting a verdict. A verdict is final: once a run is passed or
        failed the database refuses any further QC change to it.
      </p>
      <label className="block text-sm font-semibold text-[#334536]">
        Production run
        <select
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
          onChange={(event) => selectRun(event.target.value)}
          value={runId}
        >
          {editableRuns.map((run) => (
            <option key={run.id} value={run.id}>
              {run.run_date} · {run.products?.sku ?? run.product_id} · {run.quantity_produced} {run.shift} ·{" "}
              {run.qc_status}
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
      {!canChangeQc ? (
        <p className="rounded-2xl bg-[#f5f7f2] px-4 py-3 text-sm text-[#718075]">
          This run already carries a verdict, so it is read-only here.
        </p>
      ) : null}
      {message ? (
        <p
          className={`rounded-2xl px-4 py-3 text-sm ${
            failed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"
          }`}
        >
          {message}
        </p>
      ) : null}
      <button
        className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={loading || !runId || !canChangeQc}
        type="submit"
      >
        {loading ? "Saving…" : "Record verdict"}
      </button>
    </form>
  );
}
