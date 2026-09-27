"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import type { FinanceSettingsRow } from "../lib/data";
import { formatNumber } from "../lib/format";

// update_finance_settings treats a null argument as "leave this alone", which is
// how the screen sends only the field that was edited. Clearing a bucket to switch
// ageing buckets off is a different thing from leaving one unset, so it gets its
// own flag rather than being smuggled through as a null.
export function FinanceSettingsForm({ settings }: { settings: FinanceSettingsRow | null }) {
  const router = useRouter();
  const [graceDays, setGraceDays] = useState(
    settings?.ageing_grace_days === null || settings?.ageing_grace_days === undefined
      ? ""
      : String(settings.ageing_grace_days),
  );
  const [bucket1, setBucket1] = useState(settings?.ageing_bucket_1_days == null ? "" : String(settings.ageing_bucket_1_days));
  const [bucket2, setBucket2] = useState(settings?.ageing_bucket_2_days == null ? "" : String(settings.ageing_bucket_2_days));
  const [bucket3, setBucket3] = useState(settings?.ageing_bucket_3_days == null ? "" : String(settings.ageing_bucket_3_days));
  const [countsCurrent, setCountsCurrent] = useState(settings?.credit_counts_current_invoices ?? false);
  const [clearBuckets, setClearBuckets] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const bucketsConfigured = [bucket1, bucket2, bucket3].some((value) => value.trim() !== "");
  const bucketsAscending =
    !bucketsConfigured ||
    [bucket1, bucket2, bucket3]
      .filter((value) => value.trim() !== "")
      .map(Number)
      .every((value, index, all) => index === 0 || value > all[index - 1]);
  const graceValid = graceDays.trim() === "" || Number(graceDays) >= 0;
  const canSubmit = bucketsAscending && graceValid;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage("");
    setFailed(false);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("update_finance_settings", {
      p_ageing_grace_days: graceDays.trim() === "" ? null : Number(graceDays),
      p_ageing_bucket_1_days: bucket1.trim() === "" ? null : Number(bucket1),
      p_ageing_bucket_2_days: bucket2.trim() === "" ? null : Number(bucket2),
      p_ageing_bucket_3_days: bucket3.trim() === "" ? null : Number(bucket3),
      p_credit_counts_current_invoices: countsCurrent,
      p_clear_ageing_buckets: clearBuckets,
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      setFailed(true);
      return;
    }
    setMessage("Finance settings updated.");
    router.refresh();
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="rounded-2xl border border-[#e8ede6] p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#819083]">Grace period</p>
        <label className="mt-3 block text-sm font-semibold text-[#334536]">
          Days before an invoice is treated as overdue
          <input
            className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-normal"
            min="0"
            onChange={(event) => setGraceDays(event.target.value)}
            placeholder="Not set"
            type="number"
            value={graceDays}
          />
        </label>
        <p className="mt-2 text-xs text-[#718075]">
          Today is {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date())}. Leave
          blank to treat every unpaid invoice as overdue immediately.
        </p>
      </div>

      <div className="rounded-2xl border border-[#e8ede6] p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#819083]">Ageing buckets</p>
        <p className="mt-2 text-xs text-[#718075]">
          Blank buckets are not counted in ageing. Anything past the last bucket is reported as over-90 style remainder.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <label className="text-sm font-semibold text-[#334536]">
            Bucket 1 (days)
            <input
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
              min="0"
              onChange={(event) => setBucket1(event.target.value)}
              placeholder="e.g. 30"
              type="number"
              value={bucket1}
            />
          </label>
          <label className="text-sm font-semibold text-[#334536]">
            Bucket 2 (days)
            <input
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
              min="0"
              onChange={(event) => setBucket2(event.target.value)}
              placeholder="e.g. 60"
              type="number"
              value={bucket2}
            />
          </label>
          <label className="text-sm font-semibold text-[#334536]">
            Bucket 3 (days)
            <input
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
              min="0"
              onChange={(event) => setBucket3(event.target.value)}
              placeholder="e.g. 90"
              type="number"
              value={bucket3}
            />
          </label>
        </div>
        {!bucketsAscending ? (
          <p className="mt-3 rounded-xl bg-[#fff0ed] px-3 py-2 text-xs text-[#a33a2b]">
            Buckets must be in increasing order, so the ageing report cannot double count an invoice.
          </p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-[#e8ede6] p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#819083]">Credit exposure</p>
        <label className="mt-3 flex items-start gap-3 text-sm text-[#334536]">
          <input
            checked={countsCurrent}
            className="mt-1 h-4 w-4"
            onChange={(event) => setCountsCurrent(event.target.checked)}
            type="checkbox"
          />
          <span>
            Count invoices that are not yet due
            <span className="mt-1 block text-xs text-[#718075]">
              Off means only overdue invoices consume a dealer&apos;s credit headroom.
            </span>
          </span>
        </label>
      </div>

      {bucketsConfigured ? (
        <label className="flex items-start gap-3 text-sm text-[#334536]">
          <input
            checked={clearBuckets}
            className="mt-1 h-4 w-4"
            onChange={(event) => setClearBuckets(event.target.checked)}
            type="checkbox"
          />
          <span>
            Switch ageing buckets off on save
            <span className="mt-1 block text-xs text-[#718075]">Clears all three thresholds at once.</span>
          </span>
        </label>
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
        {loading ? "Saving…" : "Save finance settings"}
      </button>
      {settings ? (
        <p className="text-xs text-[#819083]">
          Last saved {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(settings.updated_at))} ·
          GST {formatNumber(settings.gst_rate)}%
        </p>
      ) : null}
    </form>
  );
}
