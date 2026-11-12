"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { SalesRepDealerRow } from "../lib/data";
import { PdfHelp } from "./pdf-help";

type Props = {
  dealers: SalesRepDealerRow[];
  reps: Array<{ rep_id: string; rep_name: string; dealer_count: number }>;
};

// Writes through public.sales_assign_dealer_to_rep rather than a direct table
// update. A manager has no UPDATE policy on dealers at all, so a direct write is
// refused by RLS before the column guard is even reached; the function is the only
// path, and it is the path that carries the four scope checks.
//
// The form does not re-implement any of them. It shows only dealers the database
// already considers the caller's, and only reps private.can_manage_rep accepts, so a
// refusal on submit is a genuine database change rather than a form that offered
// something impossible.
export function DealerAssignmentForm({ dealers, reps }: Props) {
  const router = useRouter();
  const [dealerId, setDealerId] = useState("");
  const [repId, setRepId] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  // A dealer the manager may move: it must already be held by a rep on their team.
  // getTeamDealers is scoped by can_view_dealer, so "held by my team" is what the
  // database decided, not a guess made here from a rep id the client cannot trust.
  const selected = dealers.find((dealer) => dealer.dealer_id === dealerId);
  const movable = selected && selected.sales_rep_id !== null;
  const canSubmit = Boolean(dealerId && repId && movable && repId !== selected?.sales_rep_id);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage("");
    setFailed(false);
    setLoading(true);
    const res = await fetch("/api/dealer-assignment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p_dealer_id: dealerId, p_sales_rep_id: repId }) });
    const json = await res.json();
    const error = res.ok ? null : { message: json.error ?? "Failed" };
    setLoading(false);
    if (error) {
      setMessage(error.message);
      setFailed(true);
      return;
    }
    const repName = reps.find((rep) => rep.rep_id === repId)?.rep_name ?? "the selected rep";
    setMessage(`${selected?.dealer_name ?? "Dealer"} now sits with ${repName}.`);
    setDealerId("");
    setRepId("");
    router.refresh();
  }

  if (reps.length === 0) {
    return (
      <p className="rounded-2xl bg-[#f5f7f2] px-4 py-5 text-sm text-[#718075]">
        You have no active sales reps on your team yet, so there is nobody to assign a dealer to. An admin
        creates reps and attaches them to you.
      </p>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="flex justify-end"><PdfHelp guide="16-dealer-assignment" /></div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">
          Dealer
          <select
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
            onChange={(event) => {
              setDealerId(event.target.value);
              setRepId("");
            }}
            value={dealerId}
          >
            <option value="">Choose a dealer</option>
            {dealers.map((dealer) => (
              <option key={dealer.dealer_id} value={dealer.dealer_id}>
                {dealer.dealer_name} · {dealer.region} · {dealer.rep_name}
                {dealer.status === "active" ? "" : ` (${dealer.status})`}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Move to
          <select
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal disabled:opacity-60"
            disabled={!dealerId || !movable}
            onChange={(event) => setRepId(event.target.value)}
            value={repId}
          >
            <option value="">Choose a rep</option>
            {reps
              .filter((rep) => rep.rep_id !== selected?.sales_rep_id)
              .map((rep) => (
                <option key={rep.rep_id} value={rep.rep_id}>
                  {rep.rep_name} · {rep.dealer_count} dealers
                </option>
              ))}
          </select>
        </label>
      </div>

      {dealerId && !movable ? (
        <p className="rounded-xl bg-[#fff7df] px-3 py-2 text-xs text-[#8b6412]">
          That dealer has no sales rep. Only an admin can claim an unassigned account, because an unassigned
          dealer is outside every manager&apos;s reporting line until somebody owns it.
        </p>
      ) : null}
      {dealerId && movable ? (
        <p className="rounded-xl bg-[#eef6df] px-3 py-2 text-xs text-[#4e741d]">
          Currently held by {selected?.rep_name}. This changes who can raise orders for it and who the
          exposure is reported against.
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
        disabled={loading || !canSubmit}
        type="submit"
      >
        {loading ? "Reassigning…" : "Reassign dealer"}
      </button>
    </form>
  );
}
