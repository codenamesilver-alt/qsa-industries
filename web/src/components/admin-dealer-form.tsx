"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PdfHelp } from "./pdf-help";
import type { AdminDealerRow } from "../lib/data";

type Props = {
  dealer: AdminDealerRow | null;
  salesReps: Array<{ id: string; full_name: string; role: string }>;
};

// Writes through public.admin_upsert_dealer. A direct table update is not an
// option: the admin-or-finance guard on the commercial columns splits credit_limit
// and region away from sales_rep_id, so no single .update() call could send the
// whole row without a finance user being refused for a column they never touched.
// The function also refuses a dealer with no region, which is what keeps the
// region rollup from quietly growing an Unassigned bucket.
export function AdminDealerForm({ dealer, salesReps }: Props) {
  const router = useRouter();
  const [name, setName] = useState(dealer?.name ?? "");
  const [contact, setContact] = useState(dealer?.contact_person ?? "");
  const [phone, setPhone] = useState(dealer?.phone ?? "");
  const [email, setEmail] = useState(dealer?.email ?? "");
  const [line1, setLine1] = useState(dealer?.address_line1 ?? "");
  const [line2, setLine2] = useState(dealer?.address_line2 ?? "");
  const [city, setCity] = useState(dealer?.city ?? "");
  const [state, setState] = useState(dealer?.state ?? "");
  const [postal, setPostal] = useState(dealer?.postal_code ?? "");
  const [creditLimit, setCreditLimit] = useState(dealer ? String(dealer.credit_limit) : "0");
  const [creditOverride, setCreditOverride] = useState(
    dealer?.credit_limit_override === null || dealer?.credit_limit_override === undefined
      ? ""
      : String(dealer.credit_limit_override),
  );
  const [status, setStatus] = useState<AdminDealerRow["status"]>(dealer?.status ?? "active");
  const [region, setRegion] = useState(dealer?.region ?? "");
  const [salesRepId, setSalesRepId] = useState(dealer?.sales_rep_id ?? "");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const creditValue = Number(creditLimit);
  const overrideValue = creditOverride.trim() === "" ? null : Number(creditOverride);
  const limitsValid =
    Number.isFinite(creditValue) &&
    creditValue >= 0 &&
    (overrideValue === null || (Number.isFinite(overrideValue) && overrideValue >= 0));
  const canSubmit = name.trim() !== "" && region.trim() !== "" && limitsValid;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage("");
    setFailed(false);
    setLoading(true);
    const res = await fetch("/api/admin/dealers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        p_name: name.trim(),
        p_credit_limit: creditValue,
        p_dealer_id: dealer?.id ?? null,
        p_contact_person: contact.trim() || null,
        p_phone: phone.trim() || null,
        p_email: email.trim() || null,
        p_address_line1: line1.trim() || null,
        p_address_line2: line2.trim() || null,
        p_city: city.trim() || null,
        p_state: state.trim() || null,
        p_postal_code: postal.trim() || null,
        p_credit_limit_override: overrideValue,
        p_clear_credit_override: overrideValue === null,
        p_status: status,
        p_region: region.trim(),
        p_sales_rep_id: salesRepId || null,
      }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setMessage(json.error ?? "Failed");
      setFailed(true);
      return;
    }
    setMessage(dealer ? "Dealer updated." : "Dealer created.");
    if (!dealer) {
      setName("");
      setContact("");
      setPhone("");
      setEmail("");
      setLine1("");
      setLine2("");
      setCity("");
      setState("");
      setPostal("");
      setCreditLimit("0");
      setCreditOverride("");
      setRegion("");
      setSalesRepId("");
    }
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="flex justify-end">
        <PdfHelp guide="02-admin-dealers" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">
          Dealer name
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Sales region
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setRegion(event.target.value)}
            placeholder="e.g. South"
            value={region}
          />
          {region.trim() === "" ? (
            <span className="mt-2 block text-xs font-normal text-[#a33a2b]">A dealer needs a region.</span>
          ) : null}
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Contact person
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setContact(event.target.value)}
            value={contact}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Phone
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setPhone(event.target.value)}
            value={phone}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Email
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Address line 1
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setLine1(event.target.value)}
            value={line1}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Address line 2
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setLine2(event.target.value)}
            value={line2}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          City
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setCity(event.target.value)}
            value={city}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          State
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setState(event.target.value)}
            value={state}
          />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Postal code
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setPostal(event.target.value)}
            value={postal}
          />
        </label>
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
          Account status
          <select
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
            onChange={(event) => setStatus(event.target.value as AdminDealerRow["status"])}
            value={status}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">
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
            Only an active sales rep can be mapped, because create_dealer_order reads this mapping.
          </span>
        </label>
      </div>

      {!limitsValid ? (
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
      <button
        className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={loading || !canSubmit}
        type="submit"
      >
        {loading ? "Saving…" : dealer ? "Save dealer" : "Create dealer"}
      </button>
    </form>
  );
}
