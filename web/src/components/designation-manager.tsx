"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DesignationRow } from "../lib/data";
import { PdfHelp } from "./pdf-help";

// The catalogue behind every job title dropdown in the application: the two
// account forms, the per-person title picker on the chart, and the permission
// matrix. Those all read public.designations, so a title added here appears in
// all of them at once -- there is no second list to keep in step.
//
// Creating is separate from choosing on purpose. Anyone with an admin account may
// pick any title in this list for anybody, so the pickers must not be the place
// where titles are invented; an admin typing a new one into a person's card would
// fork "Quality Head" into "Quality head" and "Quality  Head" within a month.
// The database refuses a duplicate name too, but a refusal at save time is a
// worse experience than one dropdown with one entry per title.

type Props = {
  designations: DesignationRow[];
};

export function DesignationManager({ designations }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<DesignationRow | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "good"; text: string } | null>(null);

  const active = useMemo(() => designations.filter((row) => row.is_active), [designations]);
  const retired = useMemo(() => designations.filter((row) => !row.is_active), [designations]);

  // Guarded here as well as in the database. The database check is the real one --
  // it survives a second browser and it is case-insensitive -- but a duplicate
  // name is obvious before you press the button, and "A designation called that
  // already exists" is a worse answer than the list you are looking at.
  const trimmedName = name.trim();
  const duplicate = active.some(
    (row) => row.id !== editing?.id && row.name.trim().toLowerCase() === trimmedName.toLowerCase(),
  );

  function openBlank() {
    setEditing(null);
    setName("");
    setDescription("");
    setMessage(null);
    setShowForm(true);
  }

  function openEdit(row: DesignationRow) {
    setEditing(row);
    setName(row.name);
    setDescription(row.description ?? "");
    setMessage(null);
    setShowForm(true);
  }

  function save() {
    if (!trimmedName) return;
    startTransition(async () => {
      const res = await fetch("/api/designations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p_name: trimmedName,
          p_description: description.trim() || null,
          p_sort_order: editing ? editing.sort_order : active.length,
          p_designation_id: editing?.id ?? null,
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
        text: editing ? `"${trimmedName}" was saved.` : `"${trimmedName}" was added to the catalogue.`,
      });
      // The read side caches nothing, but the dropdowns on this page were built
      // from the props this render was given, so a refresh is what actually
      // repopulates them.
      router.refresh();
    });
  }

  function retire(row: DesignationRow) {
    if (
      !window.confirm(
        `Retire "${row.name}"?\n\nIt disappears from the pickers, and anybody already holding it keeps it on their card marked as retired, so their history still reads correctly. Nothing is deleted and you can bring it back.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      // There is no "retire" RPC, and that is deliberate at this end of the
      // project: admin_delete_designation refuses outright once anybody holds the
      // title, and admin_upsert_designation only ever sets is_active to true. So
      // retiring is a direct write of one boolean, from an admin-only screen,
      // and the guard that matters -- nobody may strand a person's title -- is the
      // is_active = false read on org_people rather than a rule enforced here.
      const r = await fetch("/api/designations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, is_active: false }),
      });
      const j = await r.json();
      const error = r.ok ? null : { message: j.error ?? "Failed" };
      if (error) {
        setMessage({ tone: "error", text: error.message });
        return;
      }
      setMessage({ tone: "good", text: `"${row.name}" was retired.` });
      router.refresh();
    });
  }

  function restore(row: DesignationRow) {
    startTransition(async () => {
      // Reinstated through the upsert rather than the update above, because
      // admin_upsert_designation is the only write to this table that the
      // database has an opinion about: it re-checks the name is not a duplicate of
      // something else and it is the same path a rename takes.
      const r = await fetch("/api/designations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          p_name: row.name,
          p_description: row.description,
          p_sort_order: row.sort_order,
          p_designation_id: row.id,
        }),
      });
      const j = await r.json();
      const error = r.ok ? null : { message: j.error ?? "Failed" };
      if (error) {
        setMessage({ tone: "error", text: error.message });
        return;
      }
      setMessage({ tone: "good", text: `"${row.name}" is active again.` });
      router.refresh();
    });
  }

  const button =
    "rounded-xl border border-[#d6e1ce] bg-white px-3 py-1.5 text-sm font-semibold text-[#334536] disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={button} disabled={pending} onClick={showForm ? () => setShowForm(false) : openBlank} type="button">
          {showForm ? "Close" : "Add a job title"}
        </button>
        <p className="text-sm text-[#718075]">
          {active.length} {active.length === 1 ? "title" : "titles"} in use across the pickers.
          {retired.length > 0 ? ` ${retired.length} retired.` : ""}
        </p>
      </div>

      {message ? (
        <p
          className={
            message.tone === "error"
              ? "mt-3 rounded-xl border border-[#f0c9c2] bg-[#fdf3f1] px-3 py-2 text-sm text-[#a03a26]"
              : "mt-3 rounded-xl border border-[#dfe6dc] bg-white px-3 py-2 text-sm text-[#4f6254]"
          }
        >
          {message.text}
        </p>
      ) : null}

      {showForm ? (
        <div className="mt-4 grid gap-3 rounded-2xl border border-[#dfe6dc] bg-white p-4 sm:grid-cols-2">
          <label className="text-sm font-semibold text-[#334536]">
            Title
            <input
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="Quality Head"
              value={name}
            />
            {duplicate ? (
              <span className="mt-2 block text-xs font-normal text-[#a03a26]">
                One of these already says that.
              </span>
            ) : (
              <span className="mt-2 block text-xs font-normal text-[#718075]">
                Appears in every job title picker straight away. 120 characters.
              </span>
            )}
          </label>

          <label className="text-sm font-semibold text-[#334536]">
            What it means here
            <input
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
              maxLength={240}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Owns incoming raw material inspection"
              value={description}
            />
            <span className="mt-2 block text-xs font-normal text-[#718075]">
              Optional. Reminds whoever is assigning it what the title is for. 240 characters.
            </span>
          </label>

          <div className="sm:col-span-2">
            <button
              className="rounded-xl bg-[#2f4f36] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={pending || !trimmedName || duplicate}
              onClick={save}
              type="button"
            >
              {pending
                ? "Saving…"
                : editing
                  ? `Save "${editing.name}"`
                  : `Add "${trimmedName || "…"}"`}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {[...active, ...retired].map((row) => (
          <div
            key={row.id}
            className={
              row.is_active
                ? "flex flex-wrap items-center gap-2 rounded-xl border border-[#dfe6dc] bg-white px-3 py-2"
                : "flex flex-wrap items-center gap-2 rounded-xl border border-[#e8e8e0] bg-[#fafaf6] px-3 py-2 text-[#8d938a]"
            }
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{row.name}</p>
              {row.description ? <p className="truncate text-xs">{row.description}</p> : null}
              {!row.is_active ? (
                <p className="text-xs">Retired. Anybody holding it keeps it, marked.</p>
              ) : null}
            </div>
            <button className={button} disabled={pending} onClick={() => openEdit(row)} type="button">
              Rename
            </button>
            {row.is_active ? (
              <button className={button} disabled={pending} onClick={() => retire(row)} type="button">
                Retire
              </button>
            ) : (
              <button className={button} disabled={pending} onClick={() => restore(row)} type="button">
                Bring back
              </button>
            )}
          </div>
        ))}
      </div>

      {active.length === 0 && retired.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-[#d6e1ce] px-3 py-4 text-sm text-[#718075]">
          No job titles yet. Add the first one above and it appears in the pickers on this page and in
          both account forms.
        </p>
      ) : null}
    </div>
  );
}
