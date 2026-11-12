"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { DealerOnboardingRow } from "../lib/data";
import { PdfHelp } from "./pdf-help";

type Props = {
  // Null starts a new onboarding. A row edits one that is still open.
  record: DealerOnboardingRow | null;
};

// The two shapes of GSTIN check are duplicated from private.is_gstin and
// private.is_pan rather than invented again here. They exist to catch a paste
// before a round trip, not to be the rule: the database owns both patterns, and
// a client that disagreed with it would let a valid value through to a refusal
// and reject an invalid one before the server could name the reason. A paste with
// a trailing space is trimmed here, which is what the server does too, so the
// field the user sees is the value the server stores.
const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9]Z[0-9A-Z]$/;
const panPattern = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// A closed record is not editable, and the form says so rather than letting the
// submit button sit there and throw. admin_edit_dealer_onboarding refuses once a
// credit decision exists, because the decision is a fact about a stated request
// and moving the request afterwards leaves a signed off number nobody approved.
// Re-deciding is the way back, which is a different button on the board.
function editBlockedBy(record: DealerOnboardingRow) {
  if (record.declined_at) return "This onboarding was declined, so the record is closed.";
  if (record.activated_at) return "This dealer is live. Change the credit limit on the dealer master.";
  if (record.credit_decided_at) {
    return "A credit decision is recorded, so the request cannot move. Record a new decision instead.";
  }
  return null;
}

export function DealerOnboardingForm({ record }: Props) {
  const router = useRouter();
  const isEdit = record !== null;

  const [name, setName] = useState(record?.dealer_name ?? "");
  const [region, setRegion] = useState(record?.region ?? "");
  const [gstin, setGstin] = useState(record?.gstin ?? "");
  const [pan, setPan] = useState(record?.pan ?? "");
  const [requested, setRequested] = useState(
    record?.credit_limit_requested === null || record?.credit_limit_requested === undefined
      ? ""
      : String(record.credit_limit_requested),
  );
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postal, setPostal] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const blocked = record ? editBlockedBy(record) : null;

  // Upper cased on the way in, not on the way out. A GSTIN is defined in upper
  // case and a lower case one is a paste rather than a different tax payer, so
  // normalising as the admin types means the field always shows the value the
  // server will store, and the server normalises again as a backstop.
  const gstinValue = gstin.trim().toUpperCase();
  const panValue = pan.trim().toUpperCase();
  const gstinValid = gstinValue === "" || gstinPattern.test(gstinValue);
  const panValid = panValue === "" || panPattern.test(panValue);

  const requestedValue = requested.trim() === "" ? null : Number(requested);
  const requestedValid =
    requestedValue === null ||
    (Number.isFinite(requestedValue) && requestedValue >= 0 && !Number.isNaN(requestedValue));

  const canSubmit = isEdit
    ? blocked === null && gstinValid && panValid && requestedValid
    : name.trim() !== "" &&
      region.trim() !== "" &&
      gstinValid &&
      panValid &&
      requestedValid;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage("");
    setFailed(false);
    setLoading(true);
    // Two functions, not one merged call. admin_start_dealer_onboarding owns the
    // dealer master half at creation time; admin_edit_dealer_onboarding owns the
    // GSTIN, PAN and requested limit afterwards, and refuses once a decision
    // exists. Folding them together would mean every keystroke in the edit passed
    // through the finance facing admin_upsert_dealer, whose guard splits the
    // commercial columns away from the rest.
    const endpoint = isEdit ? "/api/dealer-onboarding" : "/api/dealer-onboarding";
    const payload = isEdit
      ? { action: "edit", p_dealer_id: record.dealer_id, p_credit_limit_requested: requestedValue }
      : { action: "start", p_name: name.trim(), p_region: region.trim(), p_gstin: gstinValue || null, p_pan: panValue || null, p_credit_limit_requested: requestedValue, p_contact_person: contact.trim() || null, p_phone: phone.trim() || null, p_email: email.trim() || null, p_address_line1: line1.trim() || null, p_address_line2: line2.trim() || null, p_city: city.trim() || null, p_state: state.trim() || null, p_postal_code: postal.trim() || null };
    const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const json = await res.json();
    const error = res.ok ? null : { message: json.error ?? "Failed" };

    setLoading(false);
    if (error) {
      setMessage(error.message);
      setFailed(true);
      return;
    }

    if (isEdit) {
      setMessage("Onboarding record updated.");
    } else {
      setMessage(
        `${name.trim()} created and waiting on a credit decision. It cannot trade yet, and the rep is not mapped.`,
      );
      setName("");
      setRegion("");
      setGstin("");
      setPan("");
      setRequested("");
      setContact("");
      setPhone("");
      setEmail("");
      setLine1("");
      setLine2("");
      setCity("");
      setState("");
      setPostal("");
    }
    router.refresh();
  }

  if (blocked) {
    return (
      <p className="rounded-2xl bg-[#f5f7f2] px-4 py-5 text-sm text-[#718075]">{blocked}</p>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="flex justify-end"><PdfHelp guide="17-dealer-onboarding" /></div>
      {!isEdit ? (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm font-semibold text-[#334536]">
            Dealer name
            <input
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
            {name.trim() === "" ? (
              <span className="mt-2 block text-xs font-normal text-[#a33a2b]">A dealer needs a name.</span>
            ) : null}
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
              <span className="mt-2 block text-xs font-normal text-[#a33a2b]">
                A dealer needs a region, so the regional report never grows an Unassigned bucket.
              </span>
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
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-semibold text-[#334536]">
          GSTIN
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal uppercase"
            maxLength={15}
            onChange={(event) => setGstin(event.target.value.toUpperCase())}
            placeholder="22AAAAA0000A1Z5"
            value={gstin}
          />
          {!gstinValid ? (
            <span className="mt-2 block text-xs font-normal text-[#a33a2b]">
              15 characters: 2 digits, 5 letters, 4 digits, a letter, a digit, Z, then a check character.
            </span>
          ) : null}
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          PAN
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal uppercase"
            maxLength={10}
            onChange={(event) => setPan(event.target.value.toUpperCase())}
            placeholder="AAAAA0000A"
            value={pan}
          />
          {!panValid ? (
            <span className="mt-2 block text-xs font-normal text-[#a33a2b]">
              10 characters: 5 letters, 4 digits, a letter.
            </span>
          ) : null}
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Credit limit requested
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            min="0"
            onChange={(event) => setRequested(event.target.value)}
            placeholder="Blank to leave unset"
            step="0.01"
            type="number"
            value={requested}
          />
          <span className="mt-2 block text-xs font-normal text-[#718075]">
            A request, not a granted limit. The dealer starts at zero and this figure is copied across only if
            credit is approved and the dealer is activated.
          </span>
        </label>
      </div>

      {!requestedValid ? (
        <p className="rounded-xl bg-[#fff0ed] px-3 py-2 text-xs text-[#a33a2b]">
          The requested credit limit must be zero or more.
        </p>
      ) : null}

      <p className="text-xs text-[#5d6b60]">
        Creating a dealer here opens an onboarding record and leaves the account inactive, uncredited and
        unmapped. The rep mapping is deliberately not asked for yet: territory is often settled after the
        paperwork, and activation refuses an unmapped dealer because nobody could raise an order for it.
      </p>

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
        {loading ? "Saving…" : isEdit ? "Save onboarding record" : "Start onboarding"}
      </button>
    </form>
  );
}
