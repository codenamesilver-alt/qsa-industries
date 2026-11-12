"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import type { OrgChartRow, OrgStaffMember } from "../lib/data";
import { flattenOrgTree, roleLabel } from "../lib/org-tree";
import { PdfHelp } from "./pdf-help";

type Props = {
  rows: OrgChartRow[];
  roster: OrgStaffMember[];
};

// The editor, and the only part of this screen an admin can change.
//
// It is a list rather than a chart, and that is the decision the screen is built
// around: the chart above is for reading the shape of the company, and a form per
// box inside a nested tree is a form nobody can scan. So the list is flat, each row
// is indented to its level, and the tree stays above as the thing every edit is
// measured against.
//
// Every write goes through one of the four admin functions, so the guards are the
// database's and not this file's. The button is disabled for the cases the
// function refuses anyway, which is a convenience rather than a security measure:
// a stale screen can still send a call the function turns down, and the refusal
// is shown as it arrives.
export function OrgChartBuilder({ rows, roster }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newUser, setNewUser] = useState("");

  const flat = useMemo(() => flattenOrgTree(rows), [rows]);
  const withUser = rows.filter((row) => row.user_id !== null);

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

  async function createRoot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newTitle.trim() === "") return;
    await call(
      "root",
      async () => {
        const res = await fetch("/api/org", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", p_parent_id: null, p_title: newTitle.trim(), p_user_id: newUser || null }) });
        const json = await res.json();
        const error = res.ok ? null : { message: json.error ?? "Failed" };
        if (error) return error.message;
        setNewTitle("");
        setNewUser("");
        return null;
      },
      "Top head added. Add the posts below it underneath this.",
    );
  }

  async function clearChart() {
    const root = rows.find((row) => row.parent_id === null);
    if (!root) return;
    if (!window.confirm("Delete the whole chart, every post in it, and start again?")) return;
    await call(
      "clear",
      async () => {
        const res = await fetch("/api/org", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", p_position_id: root.id }) });
        const json = await res.json();
        const error = res.ok ? null : { message: json.error ?? "Failed" };
        if (error) return error.message;
        return null;
      },
      "The chart was cleared. Nobody's login was touched.",
    );
  }

  const root = rows.find((row) => row.parent_id === null);

  return (
    <div className="space-y-6">
      {!root ? (
        <form className="space-y-4" onSubmit={createRoot}>
      <div className="flex justify-end"><PdfHelp guide="18-org-chart" /></div>
          <p className="text-sm text-[#5d6b60]">
            The chart is empty. It has one top head, chosen from your staff list, and everything else hangs
            below that head.
          </p>
          <NewPositionFields
            onTitle={setNewTitle}
            onUser={setNewUser}
            roster={roster}
            title={newTitle}
            takenBy={withUser}
            user={newUser}
          />
          <button
            className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:opacity-60"
            disabled={busy !== null || newTitle.trim() === ""}
            type="submit"
          >
            {busy === "root" ? "Adding…" : "Add the top head"}
          </button>
        </form>
      ) : (
        <>
          <div className="space-y-3">
            {flat.map(({ row, depth }) => (
              <PositionRow
                busy={busy}
                depth={depth}
                hasReports={rows.some((other) => other.parent_id === row.id)}
                isRoot={row.parent_id === null}
                key={row.id}
                onCall={call}
                roster={roster}
                row={row}
                rows={rows}
                takenBy={withUser}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-[#e8ede6] pt-4">
            <p className="text-xs text-[#718075]">
              {rows.length} posts · {withUser.length} filled ·{" "}
              {rows.length - withUser.length} vacant. A person may hold more than one post; the chart will
              show them twice.
            </p>
            <button
              className="ml-auto rounded-2xl border border-[#f2b8ad] px-4 py-2 text-xs font-bold text-[#a33a2b] disabled:opacity-60"
              disabled={busy !== null}
              onClick={clearChart}
              type="button"
            >
              {busy === "clear" ? "Clearing…" : "Clear the whole chart"}
            </button>
          </div>
        </>
      )}

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

// One post, with its own controls. The state is per row rather than in the parent
// so that typing a title on one post does not re-render nine pickers, and so that
// two open "add below" forms do not fight over one field.
function PositionRow({
  row,
  rows,
  roster,
  depth,
  isRoot,
  hasReports,
  busy,
  takenBy,
  onCall,
}: {
  row: OrgChartRow;
  rows: OrgChartRow[];
  roster: OrgStaffMember[];
  depth: number;
  isRoot: boolean;
  hasReports: boolean;
  busy: string | null;
  takenBy: OrgChartRow[];
  onCall: (
    label: string,
    run: () => Promise<string | null>,
    success?: string,
  ) => Promise<boolean>;
}) {
  const [title, setTitle] = useState(row.title);
  const [userId, setUserId] = useState(row.user_id ?? "");
  const [adding, setAdding] = useState(false);
  const [childTitle, setChildTitle] = useState("");
  const [childUser, setChildUser] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [rowMessage, setRowMessage] = useState("");

  // A move cannot offer the post itself, and cannot offer anything under it, or
  // the database would refuse it for putting a post above its own reports. The
  // picker is derived from the same tree the chart is drawn from, so the two cannot
  // disagree about what is below what.
  const forbidden = useMemo(() => descendantIds(rows, row.id), [rows, row.id]);
  const moveOptions = rows.filter(
    (candidate) => candidate.id !== row.id && !forbidden.has(candidate.id),
  );

  async function saveDetails() {
    const cleared = userId === "";
    await onCall(
      `save:${row.id}`,
      async () => {
        const res = await fetch("/api/org", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", p_position_id: row.id, p_title: title.trim() === "" ? null : title.trim(), p_user_id: userId === "" ? null : userId }) });
        const json = await res.json();
        const error = res.ok ? null : { message: json.error ?? "Failed" };
        if (error) return error.message;
        return null;
      },
      cleared ? "Post saved and left vacant." : "Post saved.",
    );
  }

  async function addChild(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (childTitle.trim() === "") return;
    await onCall(
      `add:${row.id}`,
      async () => {
        const res = await fetch("/api/org", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", p_parent_id: row.id, p_title: childTitle.trim(), p_user_id: childUser || null }) });
        const json = await res.json();
        const error = res.ok ? null : { message: json.error ?? "Failed" };
        if (error) return error.message;
        setChildTitle("");
        setChildUser("");
        setAdding(false);
        return null;
      },
      "Post added below.",
    );
  }

  async function move() {
    if (moveTo === "") return;
    await onCall(
      `move:${row.id}`,
      async () => {
        const res = await fetch("/api/org", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "move", p_position_id: row.id, p_new_parent_id: moveTo }) });
        const json = await res.json();
        const error = res.ok ? null : { message: json.error ?? "Failed" };
        if (error) return error.message;
        setMoveTo("");
        return null;
      },
      "Post moved.",
    );
  }

  async function remove() {
    if (hasReports) {
      setRowMessage("Move or delete the posts below this one first.");
      return;
    }
    if (!window.confirm(`Delete the post "${row.title}"? The person keeps their login.`)) return;
    await onCall(
      `delete:${row.id}`,
      async () => {
        const res = await fetch("/api/org", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", p_position_id: row.id }) });
        const json = await res.json();
        const error = res.ok ? null : { message: json.error ?? "Failed" };
        if (error) return error.message;
        return null;
      },
      "Post deleted. The person's login is untouched.",
    );
  }

  return (
    <div
      className="rounded-2xl border border-[#e8ede6] p-4"
      style={{ marginLeft: `${Math.min(depth, 6) * 20}px` }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">
          {isRoot ? "Top head" : "Post"}
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setTitle(event.target.value)}
            value={title}
          />
        </label>

        <label className="text-sm font-semibold text-[#334536]">
          Who holds it
          <select
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
            onChange={(event) => setUserId(event.target.value)}
            value={userId}
          >
            <option value="">Vacant</option>
            {roster.map((person) => (
              <option key={person.user_id} value={person.user_id}>
                {person.full_name} · {roleLabel(person.role)}
                {person.is_active ? "" : " · suspended"}
              </option>
            ))}
          </select>
          <DuplicateWarning
            onHold={row.user_id}
            rows={takenBy}
            userId={userId}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <SmallButton
          disabled={busy !== null}
          label={busy === `save:${row.id}` ? "Saving…" : "Save"}
          onClick={saveDetails}
          primary
        />
        <SmallButton
          disabled={busy !== null}
          label={adding ? "Cancel" : "Add a post below"}
          onClick={() => setAdding((open) => !open)}
        />
        {!isRoot ? <SmallButton disabled={busy !== null} label="Delete" onClick={remove} /> : null}
      </div>

      {rowMessage ? <p className="mt-2 text-xs font-bold text-[#a33a2b]">{rowMessage}</p> : null}

      {adding ? (
        <form className="mt-4 space-y-3 rounded-xl bg-[#f5f7f2] p-4" onSubmit={addChild}>
          <NewPositionFields
            onTitle={setChildTitle}
            onUser={setChildUser}
            roster={roster}
            title={childTitle}
            takenBy={takenBy}
            user={childUser}
          />
          <SmallButton
            disabled={busy !== null || childTitle.trim() === ""}
            label={busy === `add:${row.id}` ? "Adding…" : "Add below this post"}
            onClick={() => {}}
            primary
            type="submit"
          />
        </form>
      ) : null}

      {!isRoot && moveOptions.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-[#718075]">
            Reports under
            <select
              className="mt-1 block rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
              onChange={(event) => setMoveTo(event.target.value)}
              value={moveTo}
            >
              <option value="">Choose another post</option>
              {moveOptions.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </option>
              ))}
            </select>
          </label>
          <SmallButton
            disabled={busy !== null || moveTo === ""}
            label={busy === `move:${row.id}` ? "Moving…" : "Move"}
            onClick={move}
          />
        </div>
      ) : null}
    </div>
  );
}

function NewPositionFields({
  title,
  user,
  roster,
  takenBy,
  onTitle,
  onUser,
}: {
  title: string;
  user: string;
  roster: OrgStaffMember[];
  takenBy: OrgChartRow[];
  onTitle: (value: string) => void;
  onUser: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="text-sm font-semibold text-[#334536]">
        Post
        <input
          className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
          onChange={(event) => onTitle(event.target.value)}
          placeholder="Director, Head of Production, CEO…"
          value={title}
        />
      </label>
      <label className="text-sm font-semibold text-[#334536]">
        Who holds it
        <select
          className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
          onChange={(event) => onUser(event.target.value)}
          value={user}
        >
          <option value="">Vacant for now</option>
          {roster.map((person) => (
            <option key={person.user_id} value={person.user_id}>
              {person.full_name} · {roleLabel(person.role)}
              {person.is_active ? "" : " · suspended"}
            </option>
          ))}
        </select>
        <DuplicateWarning onHold={null} rows={takenBy} userId={user} />
      </label>
    </div>
  );
}

// A warning and not a refusal. The database allows one person in two posts, and
// this says so at the moment of choosing, because "why is this name twice on the
// chart" is a question the person drawing it can answer and the person reading it
// cannot.
function DuplicateWarning({
  userId,
  rows,
  onHold,
}: {
  userId: string;
  rows: OrgChartRow[];
  onHold: string | null;
}) {
  if (userId === "") return null;
  const elsewhere = rows.filter(
    (row) => row.user_id === userId && row.id !== onHold,
  );
  if (elsewhere.length === 0) return null;
  return (
    <span className="mt-2 block text-xs font-normal text-[#8b6412]">
      Also on {elsewhere.map((row) => `“${row.title}”`).join(", ")}. Two posts is allowed, and the chart
      will show both.
    </span>
  );
}

function descendantIds(rows: OrgChartRow[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const bucket = childrenOf.get(row.parent_id) ?? [];
    bucket.push(row.id);
    childrenOf.set(row.parent_id, bucket);
  }
  const found = new Set<string>();
  const walk = (id: string) => {
    for (const child of childrenOf.get(id) ?? []) {
      if (found.has(child)) continue;
      found.add(child);
      walk(child);
    }
  };
  walk(rootId);
  // The row itself counts as forbidden for the move picker, so the guard reads as
  // "everything at or below" rather than needing a separate check at the call site.
  found.add(rootId);
  return found;
}

function SmallButton({
  label,
  onClick,
  disabled,
  primary,
  type = "button",
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      className={`rounded-2xl px-4 py-2 text-xs font-bold disabled:opacity-60 ${
        primary
          ? "bg-[#15221b] text-[#d8f35b]"
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
