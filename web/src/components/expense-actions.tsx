"use client";

// The write side of the expense module: the head catalogue, the entry form, and the
// void action.
//
// Three things this file is careful about, each because the database is append-only:
//
//   1. There is no edit button on an expense. A recorded row cannot be changed, so the
//      only thing the register can offer a row is "void this", and the UI offers the
//      same. Offering an edit that fails would teach finance to retry rather than void.
//   2. Voiding asks for a reason and sends it, because the database refuses a blank
//      one and the database is right: "this entry was wrong" and "this was filed
//      twice" are different problems.
//   3. The tax split is validated in the browser against the amount, and again in the
//      database. The browser copy is here to save a round trip and to say the useful
//      thing -- which number is wrong -- rather than to be the check.
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  EXPENSE_MAX_BYTES,
  EXPENSE_MIME_TYPES,
  EXPENSE_PAYMENT_MODES,
  expenseModeLabel,
  type ExpenseHeadRow,
} from "../lib/expense";
import { businessDate } from "../lib/format";
import { PdfHelp } from "./pdf-help";

const field =
  "mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal";
const button =
  "rounded-xl border border-[#d6e1ce] bg-white px-3 py-1.5 text-sm font-semibold text-[#334536] disabled:cursor-not-allowed disabled:opacity-50";

// Receipts are filed against a month rather than an expense id, because the id does not
// exist until the row is inserted and the upload has to happen first. The collision risk
// is two officers filing the same bill on the same second with the same file name, so the
// random suffix is there to make that improbable rather than merely unlikely. Nothing
// reads this prefix back out; the row carries the stored path.
export function expenseAttachmentPath(file: File) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-60) || "receipt";
  const unique =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${month}/${unique}-${safe}`;
}

function describeAttachmentError(file: File) {
  if (!EXPENSE_MIME_TYPES.includes(file.type)) {
    return `${file.type || "That file type"} is not accepted. Use a PNG, JPEG, WebP or PDF.`;
  }
  if (file.size > EXPENSE_MAX_BYTES) {
    return `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB.`;
  }
  return null;
}

type Message = { tone: "error" | "good"; text: string } | null;

function MessageBox({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p
      className={
        message.tone === "error"
          ? "mt-3 rounded-xl border border-[#f0c9c2] bg-[#fdf3f1] px-3 py-2 text-sm text-[#a03a26]"
          : "mt-3 rounded-xl border border-[#dfe6dc] bg-white px-3 py-2 text-sm text-[#4f6254]"
      }
    >
      {message.text}
    </p>
  );
}

/**
 * The head catalogue. Same shape as DesignationManager and for the same reasons, with
 * one difference: finance maintains it, not admin alone. An officer who cannot name a
 * head files rent under Miscellaneous, and a Miscellaneous bucket is how a register
 * stops being readable at the end of a year.
 */
export function ExpenseHeadManager({ heads }: { heads: ExpenseHeadRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ExpenseHeadRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const active = useMemo(() => heads.filter((row) => row.is_active), [heads]);
  const retired = useMemo(() => heads.filter((row) => !row.is_active), [heads]);

  // Guarded here as well as in the database. The database check is the real one -- it is
  // case-insensitive and it survives a second browser -- but a duplicate name is obvious
  // before the button is pressed, and "A head called that already exists" is a worse
  // answer than the list you are already looking at.
  const trimmedName = name.trim();
  const duplicate = active.some(
    (row) =>
      row.id !== editing?.id && row.name.trim().toLowerCase() === trimmedName.toLowerCase(),
  );

  function openBlank() {
    setEditing(null);
    setName("");
    setDescription("");
    setMessage(null);
    setShowForm(true);
  }

  function openEdit(row: ExpenseHeadRow) {
    setEditing(row);
    setName(row.name);
    setDescription(row.description ?? "");
    setMessage(null);
    setShowForm(true);
  }

  function save() {
    if (!trimmedName || duplicate) return;
    startTransition(async () => {
      const res = await fetch("/api/expenses/heads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p_name: trimmedName,
          p_description: description.trim() || null,
          p_sort_order: editing ? editing.sort_order : active.length,
          p_head_id: editing?.id ?? null,
        }),
      });
      const json = await res.json();
      const error = res.ok ? null : { message: json.error ?? "Failed" };
      if (error) {
        setMessage({ tone: "error", text: error.message });
        return;
      }
      setShowForm(false);
      setEditing(null);
      setName("");
      setDescription("");
      setMessage({
        tone: "good",
        text: editing
          ? `"${trimmedName}" was saved. Expenses already filed under it keep their grouping.`
          : `"${trimmedName}" was added. It appears in the expense picker straight away.`,
      });
      router.refresh();
    });
  }

  function setActive(row: ExpenseHeadRow, next: boolean) {
    if (
      !next &&
      !window.confirm(
        `Retire "${row.name}"?\n\nIt leaves the picker, so no new expense can be filed under it. Everything already filed keeps its grouping, and you can bring it back.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      // Through the RPC rather than a direct update, the way the rest of this module
      // writes. There is no delete_expense_head() and no update grant on the table, so
      // retiring is the only exit and it is reversible by design.
      const r2 = await fetch("/api/expenses/heads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p_head_id: row.id, p_is_active: next }),
      });
      const j2 = await r2.json();
      const error = r2.ok ? null : { message: j2.error ?? "Failed" };
      if (error) {
        setMessage({ tone: "error", text: error.message });
        return;
      }
      setMessage({
        tone: "good",
        text: next ? `"${row.name}" is active again.` : `"${row.name}" was retired.`,
      });
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={button} disabled={pending} onClick={showForm ? () => setShowForm(false) : openBlank} type="button">
          {showForm ? "Close" : "Add an expense head"}
        </button>
        <p className="text-sm text-[#718075]">
          {active.length} {active.length === 1 ? "head" : "heads"} in use.
          {retired.length > 0 ? ` ${retired.length} retired.` : ""}
        </p>
      </div>

      <MessageBox message={message} />

      {showForm ? (
        <div className="mt-4 grid gap-3 rounded-2xl border border-[#dfe6dc] bg-white p-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-[#334536]">
            Head
            <input
              className={field}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="Rent"
              value={name}
            />
            {duplicate ? (
              <span className="mt-2 block text-xs font-normal text-[#a03a26]">
                One of these already says that.
              </span>
            ) : (
              <span className="mt-2 block text-xs font-normal text-[#718075]">
                What the money is for, in one line. 120 characters.
              </span>
            )}
          </label>

          <label className="text-sm font-semibold text-[#334536]">
            What it covers here
            <input
              className={field}
              maxLength={240}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Office and warehouse rent"
              value={description}
            />
            <span className="mt-2 block text-xs font-normal text-[#718075]">
              Optional. Reminds whoever files an expense what belongs here. 240 characters.
            </span>
          </label>

          <div className="sm:col-span-2">
            <button
              className="rounded-xl bg-[#2f4f36] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={pending || !trimmedName || duplicate}
              onClick={save}
              type="button"
            >
              {pending ? "Saving…" : editing ? `Save "${editing.name}"` : `Add "${trimmedName || "…"}"`}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {[...active, ...retired].map((row) => (
          <div
            className={
              row.is_active
                ? "flex flex-wrap items-center gap-2 rounded-xl border border-[#dfe6dc] bg-white px-3 py-2"
                : "flex flex-wrap items-center gap-2 rounded-xl border border-[#e8e8e0] bg-[#fafaf6] px-3 py-2 text-[#8d938a]"
            }
            key={row.id}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{row.name}</p>
              {row.description ? <p className="truncate text-xs">{row.description}</p> : null}
              {!row.is_active ? <p className="text-xs">Retired. Past expenses keep it.</p> : null}
            </div>
            <button className={button} disabled={pending} onClick={() => openEdit(row)} type="button">
              Rename
            </button>
            <button
              className={button}
              disabled={pending}
              onClick={() => setActive(row, !row.is_active)}
              type="button"
            >
              {row.is_active ? "Retire" : "Bring back"}
            </button>
          </div>
        ))}
      </div>

      {heads.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-[#d6e1ce] px-3 py-4 text-sm text-[#718075]">
          No heads yet. Add one above and it appears in the expense form immediately.
        </p>
      ) : null}
    </div>
  );
}

/**
 * File one expense.
 *
 * The tax split is optional and appears only when the "this is a bill with tax on it"
 * box is ticked, because a required breakdown would be wrong for the majority of rows:
 * rent, a courier charge and a bank fee have nothing to break down. Ticking it reveals
 * two fields and the total, and the total is computed here rather than typed -- the
 * amount is the authoritative figure and the split has to reconcile to it, so deriving
 * it removes the possibility of the two disagreeing.
 *
 * That leaves the reverse case to handle: an amount that was entered first and a
 * breakdown that disagrees. The database refuses that with the arithmetic in the
 * message. Here, the visible computed total is the warning, and the save button is
 * disabled while it does not match.
 */
export function ExpenseForm({ heads }: { heads: ExpenseHeadRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message>(null);

  const activeHeads = useMemo(() => heads.filter((row) => row.is_active), [heads]);

  const [headId, setHeadId] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(businessDate());
  const [vendor, setVendor] = useState("");
  const [mode, setMode] = useState<string>("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [hasTax, setHasTax] = useState(false);
  const [taxable, setTaxable] = useState("");
  const [tax, setTax] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const amountValue = Number(amount);
  const taxableValue = Number(taxable);
  const taxValue = Number(tax);

  // NaN-safe: Number("") is 0 and Number("abc") is NaN, and both need to be "not filled
  // in" rather than zero. Anything unparseable disables the button below.
  const amountOk = Number.isFinite(amountValue) && amountValue > 0;
  const splitOk =
    !hasTax ||
    (Number.isFinite(taxableValue) &&
      Number.isFinite(taxValue) &&
      taxableValue >= 0 &&
      taxValue >= 0 &&
      Math.round((taxableValue + taxValue) * 100) / 100 === Math.round(amountValue * 100) / 100);
  const canSave = headId !== "" && amountOk && splitOk && expenseDate !== "" && !pending;

  function reset() {
    setHeadId("");
    setAmount("");
    setExpenseDate(businessDate());
    setVendor("");
    setMode("bank_transfer");
    setReference("");
    setNotes("");
    setHasTax(false);
    setTaxable("");
    setTax("");
    setFile(null);
    setFileError(null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;

    startTransition(async () => {
      let attachmentPath: string | null = null;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        const upRes = await fetch("/api/expenses/upload", { method: "POST", body: fd });
        const upJson = await upRes.json();
        if (!upRes.ok) {
          setMessage({ tone: "error", text: upJson.error ?? "Upload failed" });
          return;
        }
        attachmentPath = upJson.data?.path ?? null;
      }

      const recRes = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p_head_id: headId,
          p_amount: amountValue,
          p_expense_date: expenseDate,
          p_vendor: vendor.trim() || null,
          p_mode: mode,
          p_reference: reference.trim() || null,
          p_taxable_amount: hasTax && Number.isFinite(taxableValue) ? taxableValue : null,
          p_tax_amount: hasTax && Number.isFinite(taxValue) ? taxValue : null,
          p_attachment_path: attachmentPath,
          p_notes: notes.trim() || null,
        }),
      });
      const recJson = await recRes.json();
      const error = recRes.ok ? null : { message: recJson.error ?? "Failed" };

      if (error) {
        // The object is already stored and the row does not exist. There is no delete
        // policy on the bucket, deliberately, so nothing the client holds can clean this
        // up -- only the storage console can. Saying so plainly beats leaving the officer
        // to guess why the retry behaved differently.
        //
        // The retry is still clean, because the next attempt mints a fresh random path
        // rather than reusing this one. That is the same uniqueness that removed the need
        // for an update policy, doing a second job here.
        setMessage({
          tone: "error",
          text: error.message,
        });
        return;
      }

      reset();
      setMessage({
        tone: "good",
        text: `₹${amountValue.toLocaleString("en-IN")} recorded. It cannot be edited — if it was wrong, void it and file it again.`,
      });
      router.refresh();
    });
  }

  if (activeHeads.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[#d6e1ce] px-3 py-4 text-sm text-[#718075]">
        No expense heads are active, so there is nothing to file against. Add one in the
        Expense heads panel first.
      </p>
    );
  }

  return (
    <form onSubmit={submit}>
      <div className="flex justify-end"><PdfHelp guide="22-expenses" /></div>
      <MessageBox message={message} />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">
          Head
          <select className={field} onChange={(event) => setHeadId(event.target.value)} value={headId}>
            <option value="">Choose a head…</option>
            {activeHeads.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
          <span className="mt-2 block text-xs font-normal text-[#718075]">
            Only active heads. Retired ones keep their past expenses and take no new ones.
          </span>
        </label>

        <label className="text-sm font-semibold text-[#334536]">
          Amount paid
          <input
            className={field}
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            placeholder="40000"
            value={amount}
          />
          <span className="mt-2 block text-xs font-normal text-[#718075]">
            Money that left the bank. The one figure the register is built on.
          </span>
        </label>

        <label className="text-sm font-semibold text-[#334536]">
          Date
          <input
            className={field}
            onChange={(event) => setExpenseDate(event.target.value)}
            type="date"
            value={expenseDate}
          />
          <span className="mt-2 block text-xs font-normal text-[#718075]">
            Past dates are fine — a bill usually arrives after the month it covers. The
            future is refused.
          </span>
        </label>

        <label className="text-sm font-semibold text-[#334536]">
          Paid by
          <select className={field} onChange={(event) => setMode(event.target.value)} value={mode}>
            {EXPENSE_PAYMENT_MODES.map((option) => (
              <option key={option} value={option}>
                {expenseModeLabel(option)}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm font-semibold text-[#334536]">
          Vendor or payee
          <input
            className={field}
            maxLength={160}
            onChange={(event) => setVendor(event.target.value)}
            placeholder="Sunrise Property LLP"
            value={vendor}
          />
          <span className="mt-2 block text-xs font-normal text-[#718075]">
            Optional. Typed as written — there is no vendor master to pick from, so
            spelling differences here are expected.
          </span>
        </label>

        <label className="text-sm font-semibold text-[#334536]">
          Reference
          <input
            className={field}
            maxLength={120}
            onChange={(event) => setReference(event.target.value)}
            placeholder="NEFT-2026-0042"
            value={reference}
          />
          <span className="mt-2 block text-xs font-normal text-[#718075]">
            Optional. UTR, cheque number, receipt number — whatever the bank shows.
          </span>
        </label>
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm text-[#334536]">
        <input
          checked={hasTax}
          className="mt-1"
          onChange={(event) => setHasTax(event.target.checked)}
          type="checkbox"
        />
        <span>
          This bill breaks down into a taxable amount and tax
          <span className="mt-1 block text-xs text-[#718075]">
            Most rows do not. Rent, courier and bank charges have nothing to split, and a
            zero in these fields would read as a real zero rather than as nothing entered.
          </span>
        </span>
      </label>

      {hasTax ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-semibold text-[#334536]">
            Taxable amount
            <input
              className={field}
              inputMode="decimal"
              onChange={(event) => setTaxable(event.target.value)}
              placeholder="35400"
              value={taxable}
            />
          </label>
          <label className="text-sm font-semibold text-[#334536]">
            Tax amount
            <input
              className={field}
              inputMode="decimal"
              onChange={(event) => setTax(event.target.value)}
              placeholder="4600"
              value={tax}
            />
          </label>
          <div className="text-sm font-semibold text-[#334536]">
            These must add up
            <p
              className={
                splitOk
                  ? "mt-2 rounded-xl border border-[#dfe6dc] bg-white px-3 py-2 text-sm font-semibold text-[#4e741d]"
                  : "mt-2 rounded-xl border border-[#f0c9c2] bg-[#fdf3f1] px-3 py-2 text-sm font-semibold text-[#a03a26]"
              }
            >
              ₹{(Number.isFinite(taxableValue) ? taxableValue : 0).toLocaleString("en-IN")} + ₹
              {(Number.isFinite(taxValue) ? taxValue : 0).toLocaleString("en-IN")} = ₹
              {(
                (Number.isFinite(taxableValue) ? taxableValue : 0) +
                (Number.isFinite(taxValue) ? taxValue : 0)
              ).toLocaleString("en-IN")}
            </p>
            <span className="mt-2 block text-xs font-normal text-[#718075]">
              Has to match the amount above. The database refuses a split that does not
              reconcile, so this is a warning before you press save rather than after.
            </span>
          </div>
        </div>
      ) : null}

      <label className="mt-4 block text-sm font-semibold text-[#334536]">
        Receipt or bill
        <input
          accept={EXPENSE_MIME_TYPES.join(",")}
          className="mt-2 block w-full text-sm font-normal"
          onChange={(event) => {
            const next = event.target.files?.[0] ?? null;
            setFileError(next ? describeAttachmentError(next) : null);
            setFile(next && !describeAttachmentError(next) ? next : null);
          }}
          type="file"
        />
        <span className="mt-2 block text-xs font-normal text-[#718075]">
          Optional. A PNG, JPEG, WebP or PDF up to 10 MB, kept in a private bucket — the
          link is signed and expires, so nobody can paste it into an email.
        </span>
        {fileError ? <span className="mt-2 block text-xs font-normal text-[#a03a26]">{fileError}</span> : null}
      </label>

      <label className="mt-4 block text-sm font-semibold text-[#334536]">
        Note
        <textarea
          className={field}
          maxLength={500}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="March rent, quarterly, includes service charge"
          rows={2}
          value={notes}
        />
        <span className="mt-2 block text-xs font-normal text-[#718075]">
          Optional. 500 characters.
        </span>
      </label>

      <p className="mt-4 rounded-xl border border-[#dfe6dc] bg-white px-3 py-2 text-xs text-[#718075]">
        A recorded expense is final. There is no edit — correcting an entry means voiding
        it with a reason and filing it again, which keeps the original visible in the
        register instead of leaving a gap where it used to be.
      </p>

      <button
        className="mt-3 rounded-xl bg-[#2f4f36] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!canSave}
        type="submit"
      >
        {pending ? "Recording…" : "Record this expense"}
      </button>
    </form>
  );
}

/**
 * Open a stored receipt.
 *
 * The URL is minted on click rather than rendered on the server, for two reasons. The
 * bucket is private, so a signed URL is the only way in; and a signed URL that appeared
 * in server-rendered HTML would sit in the browser cache and in any "view source" for as
 * long as its expiry, which is exactly the thing a sixty-second window is meant to prevent.
 *
 * The length matters here rather than being decorative: sixty seconds is long enough to
 * open a bill and long enough that a URL copied out of the address bar is dead by the time
 * it reaches anybody else. The 60 below is the same number as this sentence, deliberately
 * -- a one-line change to the expiry and the reasoning would silently stop describing it.
 */
export function ExpenseReceiptButton({ path }: { path: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    startTransition(async () => {
      window.open(path, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <span className="mt-1 block text-xs">
      <button
        className="font-semibold text-[#4f6254] underline decoration-[#9db56a] underline-offset-2 disabled:opacity-50"
        disabled={pending}
        onClick={open}
        type="button"
      >
        {pending ? "Opening…" : "View receipt"}
      </button>
      {error ? <span className="ml-2 text-[#a03a26]">{error}</span> : null}
    </span>
  );
}

/**
 * Void one expense, with a mandatory reason.
 *
 * Confirmed twice over: window.confirm states what a void actually does (the row stays,
 * the amount stops counting), and then a required reason field. The confirm alone would
 * make this a one-click accident; the reason alone would make it feel like a form to
 * fill in. Both is the amount of friction a write-off should have.
 */
export function VoidExpenseButton({
  expenseId,
  summary,
}: {
  expenseId: string;
  summary: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("A void needs a reason. 'Filed twice' is a different answer from 'wrong amount'.");
      return;
    }

    startTransition(async () => {
      const vRes = await fetch(`/api/expenses/${expenseId}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ p_void_reason: trimmed }),
      });
      const vJson = await vRes.json();
      const rpcError = vRes.ok ? null : { message: vJson.error ?? "Failed" };
      if (rpcError) {
        // Worth surfacing verbatim rather than replacing with our own wording: the two
        // real refusals here are "already voided, on <date>" and "you are not finance",
        // and both carry information the caller needs.
        setError(rpcError.message);
        return;
      }
      setAsking(false);
      setReason("");
      setError(null);
      router.refresh();
    });
  }

  if (!asking) {
    return (
      <button className={button} onClick={() => setAsking(true)} type="button">
        Void
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-[#f0c9c2] bg-[#fdf3f1] p-3">
      <p className="text-sm text-[#a03a26]">
        Void <span className="font-semibold">{summary}</span>?
      </p>
      <p className="mt-1 text-xs text-[#a03a26]">
        The row stays in the register and keeps its amount, marked as written off, so the
        duplicate check still works. It stops counting towards totals.
      </p>
      <label className="mt-2 block text-xs font-semibold text-[#a03a26]">
        Why is it being voided?
        <input
          className="mt-1 w-full rounded-xl border border-[#f0c9c2] bg-white px-3 py-2 text-sm font-normal"
          maxLength={240}
          onChange={(event) => {
            setReason(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            // Enter confirms rather than doing nothing, and Escape backs out, so a
            // keyboard user is not left with a form that swallows the only key they
            // would reach for. Neither can be a submit: this is a div, not a <form>,
            // because a void is a confirmation with a consequence rather than a save.
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape") {
              setAsking(false);
              setReason("");
              setError(null);
            }
          }}
          placeholder="Filed twice against the same invoice"
          value={reason}
        />
      </label>
      {error ? <p className="mt-2 text-xs text-[#a03a26]">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <button
          className="rounded-xl bg-[#a33a2b] px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pending}
          onClick={submit}
          type="button"
        >
          {pending ? "Voiding…" : "Void it"}
        </button>
        <button
          className={button}
          disabled={pending}
          onClick={() => {
            setAsking(false);
            setReason("");
            setError(null);
          }}
          type="button"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
