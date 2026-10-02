"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import type { DealerOnboardingRow, DealerOnboardingStage } from "../lib/data";

type Props = {
  record: DealerOnboardingRow;
  salesReps: Array<{ id: string; full_name: string }>;
  // The dealer's own email, from the dealer master. Not on the board view, and
  // used only to prefill the login form: the login address is a decision the
  // admin confirms rather than one this screen infers.
  dealerEmail?: string | null;
};

// The stages the database derives, given a label and a colour. The label is the
// column value rather than a nicer synonym, because an admin reading
// "credit_refused" and one reading "Credit refused" are the same word and the
// column can be matched against a filter or a test. Inventing a seventh display
// string per stage would be a second vocabulary to keep in step.
const stageLabels: Record<DealerOnboardingStage, string> = {
  paper: "Paper only",
  awaiting_credit: "Awaiting credit decision",
  credit_refused: "Credit refused",
  awaiting_login: "Awaiting login",
  awaiting_activation: "Awaiting activation",
  live: "Live",
  deactivated: "Deactivated since",
  declined: "Declined",
};

const stageTone: Record<DealerOnboardingStage, string> = {
  paper: "border-[#d6e1ce] bg-[#f5f7f2] text-[#4f6254]",
  awaiting_credit: "border-[#f0d79a] bg-[#fff7df] text-[#8b6412]",
  credit_refused: "border-[#f2b8ad] bg-[#fff0ed] text-[#a33a2b]",
  awaiting_login: "border-[#f0d79a] bg-[#fff7df] text-[#8b6412]",
  awaiting_activation: "border-[#b9d98a] bg-[#eff8df] text-[#4e741d]",
  live: "border-[#b9d98a] bg-[#eff8df] text-[#4e741d]",
  deactivated: "border-[#d6e1ce] bg-[#f5f7f2] text-[#4f6254]",
  declined: "border-[#f2b8ad] bg-[#fff0ed] text-[#a33a2b]",
};

function fact(label: string, value: string) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.12em] text-[#819083]">{label}</p>
      <p className="mt-1 text-sm text-[#334536]">{value}</p>
    </div>
  );
}

export function DealerOnboardingCard({ record, salesReps, dealerEmail }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  // Credit decision state. The reason is mandatory only on a refusal, and that
  // asymmetry is the point rather than an inconsistency: refusing a dealer's
  // credit is the outcome someone is later asked to justify, so a refusal with no
  // recorded reason is not a decision. An approval note is optional context.
  const [decision, setDecision] = useState<"approve" | "refuse">("approve");
  const [note, setNote] = useState("");

  // Rep mapping.
  const [repId, setRepId] = useState(record.sales_rep_id ?? "");

  // Login provisioning.
  const [loginEmail, setLoginEmail] = useState(dealerEmail ?? "");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginName, setLoginName] = useState(record.dealer_name);

  // Decline.
  const [declineReason, setDeclineReason] = useState("");

  const closed = record.declined_at !== null;
  const live = record.activated_at !== null && record.dealer_status === "active";
  const isClosed = closed || live;

  // Credit can only be approved against a requested figure, because approving
  // nothing would activate a dealer at zero and read as a decision nobody made.
  const canApprove = record.credit_limit_requested !== null;
  const canDecide = !isClosed;
  const canMapRep = !closed;
  const canProvisionLogin = !closed && record.credit_approved === true && record.login_user_id === null;

  // Activation has three preconditions and all three are in admin_activate_dealer,
  // not here. The button is disabled by the same three tests the function runs, so
  // an admin is not invited to press it and read a refusal: approved credit, a
  // provisioned login, and a rep mapped.
  //
  // The rep is tested as present rather than as active, because the board carries
  // sales_rep_id and a name but not the rep's is_active flag. A dealer pointed at a
  // rep who has since been disabled still passes this gate and is refused by the
  // function, which is the right way round: the browser does not get to be the
  // authority on a fact it cannot see, and the refusal names the rep.
  const canActivate =
    !closed &&
    record.credit_approved === true &&
    record.login_user_id !== null &&
    record.sales_rep_id !== null;

  // The reason the activation button is disabled, in the flow's own order, taken
  // from the four preconditions rather than from a second reading of the stage.
  // The stage says which state the record is in; this says which single thing is
  // holding it, which is the question an admin is actually asking.
  const activationBlocker = !canActivate
    ? record.credit_approved !== true
      ? "Waiting on a credit approval."
      : record.login_user_id === null
        ? "Waiting on a provisioned login. A dealer nobody can sign in as is a hole in the book."
        : record.sales_rep_id === null
          ? "Waiting on an active sales rep. Nobody can order for an unmapped dealer."
          : "Waiting on the preconditions above."
    : null;

  async function call(label: string, run: () => Promise<string | null>) {
    setBusy(label);
    setMessage("");
    setFailed(false);
    const outcome = await run();
    setBusy(null);
    if (outcome) {
      setMessage(outcome);
      setFailed(true);
      return false;
    }
    router.refresh();
    return true;
  }

  async function submitDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canDecide) return;
    if (decision === "refuse" && note.trim() === "") {
      setMessage("Refusing credit needs a reason. It is the answer to why this dealer has no credit.");
      setFailed(true);
      return;
    }
    const supabase = createClient();
    await call("decision", async () => {
      const { error } = await supabase.rpc("admin_record_dealer_credit_decision", {
        p_dealer_id: record.dealer_id,
        p_approved: decision === "approve",
        p_note: note.trim() || null,
      });
      if (error) return error.message;
      setNote("");
      setMessage(
        decision === "approve"
          ? "Credit approved. The requested limit becomes the dealer limit when it is activated."
          : "Credit refused. The record stays open, so it can be decided again on a different figure.",
      );
      return null;
    });
  }

  async function submitRep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canMapRep) return;
    const supabase = createClient();
    await call("rep", async () => {
      // A single column, through a function that names the refusal. Sending the
      // whole dealer master to change one field would resend whatever a finance
      // user changed in the meantime and route an admin's rep change through the
      // commercial column guard, which answers about credit for a rep change.
      const { error } = await supabase.rpc("admin_map_dealer_to_rep", {
        p_dealer_id: record.dealer_id,
        p_sales_rep_id: repId || null,
      });
      if (error) return error.message;
      setMessage(repId ? "Rep mapped." : "Rep cleared. The dealer is unmapped and only an admin can claim it.");
      return null;
    });
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canProvisionLogin) return;
    if (loginEmail.trim() === "" || loginPassword === "") {
      setMessage("A login needs an email address and a password.");
      setFailed(true);
      return;
    }
    // The edge function, not an RPC. Creating an auth user needs the service role
    // key, which must never reach a browser, so the browser holds a session and
    // the function holds the key. The function re-checks that the caller is an
    // admin in the database before it does anything, and then calls
    // admin_link_dealer_login, which is granted to service_role alone.
    const accessToken = (await createClient().auth.getSession()).data.session?.access_token;
    if (!accessToken) {
      setMessage("Your session has expired. Sign in again to provision a login.");
      setFailed(true);
      return;
    }
    await call("login", async () => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/provision-dealer-login`,
        {
          method: "POST",
          headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            dealer_id: record.dealer_id,
            email: loginEmail.trim(),
            password: loginPassword,
            full_name: loginName.trim() || record.dealer_name,
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        return typeof body?.error === "string" ? body.error : `Provisioning failed (${response.status}).`;
      }
      setLoginPassword("");
      setMessage("Login provisioned and attached to this dealer. The password is not stored here.");
      return null;
    });
  }

  async function submitActivate() {
    const supabase = createClient();
    await call("activate", async () => {
      const { error } = await supabase.rpc("admin_activate_dealer", { p_dealer_id: record.dealer_id });
      if (error) return error.message;
      setMessage("Dealer activated. It can trade, and the approved limit is now its limit.");
      return null;
    });
  }

  async function submitDecline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (declineReason.trim() === "") {
      setMessage("Declining an onboarding needs a reason.");
      setFailed(true);
      return;
    }
    const supabase = createClient();
    await call("decline", async () => {
      const { error } = await supabase.rpc("admin_decline_dealer_onboarding", {
        p_dealer_id: record.dealer_id,
        p_reason: declineReason.trim(),
      });
      if (error) return error.message;
      setDeclineReason("");
      setMessage("Onboarding declined. The dealer row stays, inactive, and the record is closed.");
      return null;
    });
  }

  return (
    <div className="rounded-2xl border border-[#e8ede6] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{record.dealer_name}</p>
          <p className="mt-1 text-xs text-[#819083]">
            {record.region ?? "No region"} · {record.state ?? "—"} · dealer {record.dealer_status}
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${stageTone[record.stage]}`}>
          {stageLabels[record.stage]}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {fact("GSTIN", record.gstin ?? "—")}
        {fact("PAN", record.pan ?? "—")}
        {fact("Limit requested", record.credit_limit_requested === null ? "—" : `₹${record.credit_limit_requested}`)}
        {fact("Limit in force", `₹${record.credit_limit}`)}
        {fact("Sales rep", record.rep_name)}
        {fact("Login", record.login_email ?? "Not provisioned")}
        {fact(
          "Credit decision",
          record.credit_decided_at === null
            ? "None recorded"
            : `${record.credit_approved === true ? "Approved" : "Refused"} by ${record.credit_decided_by_name}`,
        )}
        {fact("Opened", new Date(record.created_at).toISOString().slice(0, 10))}
      </div>

      {record.credit_decision_note ? (
        <p className="mt-4 rounded-xl bg-[#f5f7f2] px-3 py-2 text-xs text-[#5d6b60]">
          Decision note: {record.credit_decision_note}
        </p>
      ) : null}

      {record.decline_reason ? (
        <p className="mt-4 rounded-xl bg-[#fff0ed] px-3 py-2 text-xs text-[#a33a2b]">
          Declined: {record.decline_reason}
        </p>
      ) : null}

      {record.outstanding && record.outstanding.length ? (
        <p className="mt-4 rounded-xl bg-[#fff7df] px-3 py-2 text-xs text-[#8b6412]">
          Still to do, in the order the flow runs: {record.outstanding.join(", ")}.
        </p>
      ) : null}

      {/* -------------------------------------------------- credit decision */}
      {canDecide ? (
        <form className="mt-5 space-y-3 border-t border-[#eef1ec] pt-5" onSubmit={submitDecision}>
          <p className="text-sm font-semibold text-[#334536]">Credit decision</p>
          <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
            <label className="text-sm text-[#334536]">
              Outcome
              <select
                className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2"
                onChange={(event) => setDecision(event.target.value as "approve" | "refuse")}
                value={decision}
              >
                <option value="approve">Approve</option>
                <option value="refuse">Refuse</option>
              </select>
            </label>
            <label className="text-sm text-[#334536]">
              {decision === "refuse" ? "Reason (required)" : "Note (optional)"}
              <input
                className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2"
                onChange={(event) => setNote(event.target.value)}
                value={note}
              />
            </label>
          </div>
          {decision === "approve" && !canApprove ? (
            <p className="rounded-xl bg-[#fff0ed] px-3 py-2 text-xs text-[#a33a2b]">
              No limit was requested, so approval is refused. Record the request first, on the onboarding record.
            </p>
          ) : null}
          <p className="text-xs text-[#718075]">
            A decision can be recorded again. A refusal is not a closure: it is a decision about a number, and
            the record stays open for a different figure. Declining the onboarding is the separate act below.
          </p>
          <button
            className="rounded-2xl bg-[#15221b] px-5 py-2.5 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy !== null || (decision === "approve" && !canApprove)}
            type="submit"
          >
            {busy === "decision" ? "Recording…" : decision === "approve" ? "Approve credit" : "Refuse credit"}
          </button>
        </form>
      ) : null}

      {/* ------------------------------------------------------- rep mapping */}
      {canMapRep ? (
        <form className="mt-5 space-y-3 border-t border-[#eef1ec] pt-5" onSubmit={submitRep}>
          <p className="text-sm font-semibold text-[#334536]">Sales rep</p>
          <div className="grid gap-3 md:grid-cols-[1fr_14rem]">
            <label className="text-sm text-[#334536]">
              Mapped rep
              <select
                className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2"
                onChange={(event) => setRepId(event.target.value)}
                value={repId}
              >
                <option value="">Unassigned</option>
                {salesReps.map((rep) => (
                  <option key={rep.id} value={rep.id}>
                    {rep.full_name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                className="w-full rounded-2xl bg-[#15221b] px-5 py-2.5 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy !== null || repId === (record.sales_rep_id ?? "")}
                type="submit"
              >
                {busy === "rep" ? "Saving…" : "Map rep"}
              </button>
            </div>
          </div>
          <p className="text-xs text-[#718075]">
            Activation refuses a dealer with no active rep, because create_dealer_order reads this mapping and
            an unmapped account cannot be ordered for by anyone.
          </p>
        </form>
      ) : null}

      {/* ------------------------------------------------- login provisioning */}
      {canProvisionLogin ? (
        <form className="mt-5 space-y-3 border-t border-[#eef1ec] pt-5" onSubmit={submitLogin}>
          <p className="text-sm font-semibold text-[#334536]">Provision the dealer login</p>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm text-[#334536]">
              Login name
              <input
                className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2"
                onChange={(event) => setLoginName(event.target.value)}
                value={loginName}
              />
            </label>
            <label className="text-sm text-[#334536]">
              Email
              <input
                className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2"
                onChange={(event) => setLoginEmail(event.target.value)}
                type="email"
                value={loginEmail}
              />
            </label>
            <label className="text-sm text-[#334536]">
              Password
              <input
                className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2"
                onChange={(event) => setLoginPassword(event.target.value)}
                type="password"
                value={loginPassword}
              />
            </label>
          </div>
          <p className="text-xs text-[#718075]">
            Creating the login goes through an edge function, because auth.users needs the service role key and
            that key must never reach a browser. The function re-checks that you are an active admin in the
            database before it creates anything, so it is not trusting this screen&apos;s own gate.
          </p>
          <button
            className="rounded-2xl bg-[#15221b] px-5 py-2.5 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy !== null || loginEmail.trim() === "" || loginPassword === ""}
            type="submit"
          >
            {busy === "login" ? "Provisioning…" : "Create login"}
          </button>
        </form>
      ) : null}

      {/* --------------------------------------------------------- activation */}
      {!closed ? (
        <div className="mt-5 border-t border-[#eef1ec] pt-5">
          <p className="text-sm font-semibold text-[#334536]">Activate</p>
          <p className="mt-2 text-xs text-[#718075]">
            Makes this dealer trade. Requires an approved credit decision, a provisioned login and an active
            rep mapped. The approved requested limit is copied onto the dealer at this point, and that is the
            only way a newly onboarded dealer gets one.
          </p>
          <button
            className="mt-3 rounded-2xl bg-[#15221b] px-5 py-2.5 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy !== null || !canActivate}
            onClick={submitActivate}
            type="button"
          >
            {busy === "activate" ? "Activating…" : "Activate dealer"}
          </button>
          {!canActivate ? (
            <p className="mt-2 text-xs text-[#8b6412]">{activationBlocker}</p>
          ) : null}
        </div>
      ) : null}

      {/* ------------------------------------------------------------ decline */}
      {!closed && !live ? (
        <form className="mt-5 space-y-3 border-t border-[#eef1ec] pt-5" onSubmit={submitDecline}>
          <p className="text-sm font-semibold text-[#334536]">Decline this onboarding</p>
          <label className="block text-sm text-[#334536]">
            Reason (required)
            <input
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2"
              onChange={(event) => setDeclineReason(event.target.value)}
              value={declineReason}
            />
          </label>
          <p className="text-xs text-[#718075]">
            A closure, not a credit decision. The dealer row stays, inactive, because orders and invoices
            reference it. There is no reopen: a dealer who comes back is a new onboarding.
          </p>
          <button
            className="rounded-2xl border border-[#f2b8ad] bg-[#fff0ed] px-5 py-2.5 text-sm font-bold text-[#a33a2b] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy !== null || declineReason.trim() === ""}
            type="submit"
          >
            {busy === "decline" ? "Declining…" : "Decline onboarding"}
          </button>
        </form>
      ) : null}

      {message ? (
        <p
          className={`mt-5 rounded-2xl px-4 py-3 text-sm ${
            failed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
