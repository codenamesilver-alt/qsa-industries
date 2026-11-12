"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import type { DesignationRow, OrgPersonRow } from "../lib/data";
import { descendantPeopleIds, flattenPeopleTree } from "../lib/org-people-tree";
import { roleLabel } from "../lib/org-tree";
import { PdfHelp } from "./pdf-help";

type Props = {
  rows: OrgPersonRow[];
  designations: DesignationRow[];
};

// The editor, and the only part of this screen an admin can change.
//
// It is a list rather than a chart, and that is the decision the screen is built
// around: the chart above is for reading the shape of the company, and a form per
// box inside a nested tree is a form nobody can scan. So the list is flat, each row
// is indented to its level, and the tree stays above as the thing every edit is
// measured against.
//
// Two things are editable per person, and only two. The designation is which entry
// of the catalogue this person's job title is, and the reporting line is who they
// report to. Everything else about an account -- its name, role, phone, dealer link
// and password -- belongs to /internal/users, where the guards for those fields
// already are, and duplicating them here would give an admin two places to make the
// same change and one place that wins.
//
// This screen therefore cannot create anybody. It used to: the account came from
// admin_create_user_account and the reporting line from admin_set_reports_to, two
// round trips on a screen whose subject is the shape of the company. A chart is not
// where a hire starts, and the two-call flow could also half-succeed -- the login
// created and the reporting line refused -- which left the person on the chart as a
// head until somebody noticed. Making an account is now one call on one screen.
//
// Every write goes through one of the admin functions, so the guards are the
// database's and not this file's. The picker leaves out the shapes the function
// refuses anyway, which is a convenience rather than a security measure: a stale
// screen can still send a call the function turns down, and the refusal is shown as
// it arrives.
export function OrgPeopleBuilder({ rows, designations }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);

  const flat = useMemo(() => flattenPeopleTree(rows), [rows]);
  const heads = rows.filter((row) => row.reports_to_id === null);

  // One place where a write is made, so a refusal, a busy flag and a success line
  // read the same whichever button was pressed. The run function returns the
  // database's own message on failure and null on success, which keeps every guard
  // in one place: the SQL decides, this reports.
  async function call(label: string, run: () => Promise<string | null>, success = "Saved.") {
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
    setMessage(success);
    router.refresh();
    return true;
  }

  async function clearChart() {
    if (
      !window.confirm(
        "Detach everybody from the chart? Every employee becomes a top head, and no login, name, job title or dealer is touched.",
      )
    ) {
      return;
    }
    await call(
      "clear",
      async () => {
        const res = await fetch("/api/org", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "clear_chart" }) });
      const json = await res.json();
      const error = res.ok ? null : { message: json.error ?? "Failed" };
        if (error) return error.message;
        return null;
      },
      "The chart was cleared. Nobody's login was touched.",
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {flat.map(({ row, depth }) => (
          <PersonRow
            busy={busy}
            depth={depth}
            designations={designations}
            key={row.user_id}
            onCall={call}
            person={row}
            rows={rows}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-[#e8ede6] pt-4">
        <p className="text-xs text-[#718075]">
          {rows.length} people · {heads.length} at the top ·{" "}
          {rows.filter((row) => row.designation_id === null).length} with no job title yet.
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <Link
            className="rounded-full border border-[#d6e1ce] px-4 py-2 text-xs font-bold text-[#4f6254] hover:bg-[#f5f7f2]"
            href="/internal/users"
          >
            Add someone on Users &amp; Roles
          </Link>
          <SmallButton
            danger
            disabled={busy !== null || heads.length === rows.length}
            label={busy === "clear" ? "Clearing…" : "Clear every reporting line"}
            onClick={clearChart}
          />
        </div>
      </div>

      {message ? (
        <p
          className={`rounded-2xl px-4 py-3 text-sm ${
            failed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

// One person, with the two things about them that the org chart owns.
//
// The state is per row rather than in the parent so that choosing a different
// manager on one row does not re-render every other row's picker.
function PersonRow({
  person,
  rows,
  designations,
  depth,
  busy,
  onCall,
}: {
  person: OrgPersonRow;
  rows: OrgPersonRow[];
  designations: DesignationRow[];
  depth: number;
  busy: string | null;
  onCall: (
    label: string,
    run: () => Promise<string | null>,
    success?: string,
  ) => Promise<boolean>;
}) {
  const [designationId, setDesignationId] = useState(person.designation_id ?? "");
  const [reportsToId, setReportsToId] = useState(person.reports_to_id ?? "");
  const [rowMessage, setRowMessage] = useState("");

  // A person cannot report to themselves or to anybody who already reports to them,
  // or the chart would stop being a tree. The picker is derived from the same rows
  // the chart is drawn from, so the two cannot disagree about what is below what,
  // and the function refuses the same shapes a moment later if the screen is stale.
  const forbidden = useMemo(() => descendantPeopleIds(rows, person.user_id), [rows, person.user_id]);
  const managerOptions = rows.filter(
    (candidate) => candidate.user_id !== person.user_id && !forbidden.has(candidate.user_id),
  );

  // A choice that has been made but is no longer offered is dropped rather than sent,
  // so the two controls cannot disagree with the list they are drawn from.
  const effectiveDesignationId = designations.some((entry) => entry.id === designationId)
    ? designationId
    : "";
  const effectiveReportsToId = managerOptions.some((candidate) => candidate.user_id === reportsToId)
    ? reportsToId
    : "";

  const designationChanged = effectiveDesignationId !== (person.designation_id ?? "");
  const reportsToChanged = effectiveReportsToId !== (person.reports_to_id ?? "");

  async function save() {
    setRowMessage("");
    if (!designationChanged && !reportsToChanged) return;
    // Two calls, and the order matters. The designation goes first because it is
    // independent of the shape of the tree, so if the reporting line is refused the
    // title is already correct rather than the save being lost whole.
    await onCall(
      `save:${person.user_id}`,
      async () => {
        if (designationChanged) {
          const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p_user_id: person.user_id, p_full_name: person.full_name, p_role: person.role, p_is_active: person.is_active, p_designation_id: effectiveDesignationId || null }) });
          const json = await res.json();
          const error = res.ok ? null : { message: json.error ?? "Failed" };
          if (error) return error.message;
        }
        if (reportsToChanged) {
          const res = await fetch("/api/org", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_reports_to", p_user_id: person.user_id, p_reports_to_id: effectiveReportsToId || null }) });
          const json = await res.json();
          const error = res.ok ? null : { message: json.error ?? "Failed" };
          if (error) return error.message;
        }
        return null;
      },
      "Saved.",
    );
  }

  return (
    <div
      className="rounded-2xl border border-[#e8ede6] p-4"
      style={{ marginLeft: `${Math.min(depth, 6) * 20}px` }}
    >
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-sm font-bold text-[#15221b]">{person.full_name}</p>
        <p className="text-xs text-[#718075]">
          {person.email} · {roleLabel(person.role)}
          {person.is_active ? "" : " · login suspended"}
        </p>
        {person.reports_to_id === null ? (
          <span className="rounded-full border border-[#c9d6c0] bg-[#f5f7f2] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#4f6254]">
            Top of the company
          </span>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">
          Job title
          <select
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
            onChange={(event) => setDesignationId(event.target.value)}
            value={effectiveDesignationId}
          >
            <option value="">No job title yet</option>
            {designations.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
                {entry.is_active ? "" : " · retired"}
              </option>
            ))}
          </select>
          <span className="mt-2 block text-xs font-normal text-[#718075]">
            {entryDescription(designations, effectiveDesignationId) ??
              "Chosen from the catalogue, so the permission screen and the chart agree on one list. A job title decides nothing about what the account may do."}
          </span>
        </label>

        <label className="text-sm font-semibold text-[#334536]">
          Reports to
          <select
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
            onChange={(event) => setReportsToId(event.target.value)}
            value={effectiveReportsToId}
          >
            <option value="">Nobody — top of the company</option>
            {managerOptions.map((candidate) => (
              <option key={candidate.user_id} value={candidate.user_id}>
                {candidate.full_name}
                {candidate.designation ? ` · ${candidate.designation}` : ""}
                {candidate.is_active ? "" : " · suspended"}
              </option>
            ))}
          </select>
          <span className="mt-2 block text-xs font-normal text-[#718075]">
            This is the org chart&rsquo;s reporting line. It is not the sales reporting line on the admin
            screen, which is what decides whose dealers and revenue a login may see.
          </span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <SmallButton
          disabled={busy !== null || (!designationChanged && !reportsToChanged)}
          label={busy === `save:${person.user_id}` ? "Saving…" : "Save"}
          onClick={save}
          primary
        />
      </div>

      {rowMessage ? <p className="mt-2 text-xs font-bold text-[#a33a2b]">{rowMessage}</p> : null}
    </div>
  );
}

function entryDescription(
  designations: DesignationRow[],
  designationId: string,
): string | null {
  if (designationId === "") return null;
  const entry = designations.find((candidate) => candidate.id === designationId);
  if (!entry?.description) return null;
  return entry.description;
}

function SmallButton({
  label,
  onClick,
  disabled,
  primary,
  danger,
  type = "button",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      className={`rounded-2xl px-4 py-2 text-xs font-bold disabled:opacity-60 ${
        primary
          ? "bg-[#15221b] text-[#d8f35b]"
          : danger
            ? "border border-[#f2b8ad] text-[#a33a2b]"
            : "border border-[#d6e1ce] bg-white text-[#4f6254]"
      }`}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {label}
    </button>
  );
}
