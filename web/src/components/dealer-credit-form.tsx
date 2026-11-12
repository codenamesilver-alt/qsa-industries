"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { DealerRow } from "../lib/data";
import { formatNumber } from "../lib/format";
import { PdfHelp } from "./pdf-help";

type Props = {
  dealer: DealerRow;
  canManageCommercial: boolean;
  canAssignRep: boolean;
  salesReps: Array<{ id: string; full_name: string; role: string }>;
};

// This form writes to public.dealers directly, which only became possible in
// 20260926100600. private.guard_dealer_commercial_columns then splits the
// columns in two: the four commercial ones are admin or finance, and sales_rep_id
// is admin alone. canManageCommercial and canAssignRep carry that same split so
// the screen offers a finance user a field the database would refuse.
export function DealerCreditForm({ dealer, canManageCommercial, canAssignRep, salesReps }: Props) {
  const router = useRouter();
  const [creditLimit, setCreditLimit] = useState(String(dealer.credit_limit));
  const [creditOverride, setCreditOverride] = useState(
    dealer.credit_limit_override === null ? "" : String(dealer.credit_limit_override),
  );
  const [region, setRegion] = useState(dealer.region ?? "");
  const [status, setStatus] = useState(dealer.status);
  const [salesRepId, setSalesRepId] = useState(dealer.sales_rep_id ?? "");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const effectiveLimit = creditOverride.trim() === "" ? Number(creditLimit) : Number(creditOverride);
  const limitsValid = Number.isFinite(Number(creditLimit)) && Number(creditLimit) >= 0;
  const overrideValid =
    creditOverride.trim() === "" || (Number.isFinite(Number(creditOverride)) && Number(creditOverride) >= 0);
  const canSubmit = limitsValid && overrideValid;

  // Sending the whole row rather than a diff would be simpler, except that a
  // finance user submitting this form would then also send sales_rep_id and be
  // refused for a column they never touched. So the payload is assembled from the
  // fields this user is actually allowed to write.
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage("");
    setFailed(false);
    setLoading(true);
    const patch: Record<string, unknown> = {};
    if (canManageCommercial) {
      patch.credit_limit = Number(creditLimit);
      patch.credit_limit_override = creditOverride.trim() === "" ? null : Number(creditOverride);
      patch.region = region.trim() || null;
      patch.status = status;
    }
    if (canAssignRep) {
      patch.sales_rep_id = salesRepId || null;
    }
    const res = await fetch(`/api/dealers/${dealer.id}/credit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patch }) });
    const json = await res.json();
    const error = res.ok ? null : { message: json.error ?? "Failed" };
    setLoading(false);
    if (error) {
      setMessage(error.message);
      setFailed(true);
      return;
    }
    setMessage("Dealer account updated.");
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="flex justify-end"><PdfHelp guide="15-dealer-credit" /></div>
      {canManageCommercial ? (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-semibold text-[#334536]">
            Base credit limit
            <input
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
              min="0"
              onChange={(event) => setCreditLimit(event.target.value)}
              step="0.01"
              type="number"
              value={creditLimit}
            />
          </label>
          <label className="text-sm font-semibold text-[#334536]">
            Credit limit override
            <input
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
              min="0"
              onChange={(event) => setCreditOverride(event.target.value)}
              placeholder="Blank to use the base limit"
              step="0.01"
              type="number"
              value={creditOverride}
            />
          </label>
          <label className="text-sm font-semibold text-[#334536]">
            Region
            <input
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
              onChange={(event) => setRegion(event.target.value)}
              placeholder="e.g. South"
              value={region}
            />
          </label>
          <label className="text-sm font-semibold text-[#334536]">
            Account status
            <select
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
              onChange={(event) => setStatus(event.target.value as DealerRow["status"])}
              value={status}
            >
              <option value="active">Active</option>
              {/* inactive is the sanctioned retirement path, and the dealer master
                  offers it. Without it this select is controlled with a value that
                  matches no option, so the browser shows Active while state still
                  holds inactive, and touching the select writes active back --
                  silently reactivating a deliberately retired account. */}
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
          </label>
        </div>
      ) : null}

      {canAssignRep ? (
        <label className="block text-sm font-semibold text-[#334536]">
          Sales rep
          <select
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
            onChange={(event) => setSalesRepId(event.target.value)}
            value={salesRepId}
          >
            <option value="">Unassigned</option>
            {salesReps.map((rep) => (
              <option key={rep.id} value={rep.id}>
                {rep.full_name} · {rep.role.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <span className="mt-2 block text-xs font-normal text-[#718075]">
            Reassignment moves the account&apos;s credit exposure attribution, so it is an admin-only decision.
          </span>
        </label>
      ) : null}

      {!canManageCommercial && !canAssignRep ? (
        <p className="text-sm text-[#718075]">Your role cannot change this dealer&apos;s commercial settings.</p>
      ) : null}

      <p className="text-xs text-[#5d6b60]">
        Effective credit limit after this change: ₹{formatNumber(Number.isFinite(effectiveLimit) ? effectiveLimit : 0)}
        {creditOverride.trim() === "" ? " (base limit)" : " (override)"}
      </p>
      {!limitsValid || !overrideValid ? (
        <p className="rounded-xl bg-[#fff0ed] px-3 py-2 text-xs text-[#a33a2b]">
          Credit limits must be zero or more.
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
      {(canManageCommercial || canAssignRep) && (
        <button
          className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading || !canSubmit}
          type="submit"
        >
          {loading ? "Saving…" : "Save dealer account"}
        </button>
      )}
    </form>
  );
}
