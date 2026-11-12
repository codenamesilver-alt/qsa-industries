"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function TicketCreateForm({ users }: { users: { id: string; full_name: string; role: string }[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [approver, setApprover] = useState("");

  function onRaisedByChange(userId: string) {
    // auto-resolve reporting manager
    // (client doesn't have reports_to; server resolves). Just keep approver empty -> server resolves.
    setApprover("");
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setFailed(false);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, any> = {};
    for (const [k, v] of fd.entries()) body[k] = v === "" ? null : v;
    const res = await fetch("/api/tickets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", ...body }) });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setFailed(true);
      setMessage(json.error ?? "Failed");
      return;
    }
    setMessage(`Ticket ${json.data.ticket_number} created (status: ${json.data.status}).`);
    e.currentTarget.reset();
    router.refresh();
  }

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-semibold text-[#334536]">
          Raised by
          <select className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="raised_by" onChange={(e) => onRaisedByChange(e.target.value)}>
            <option value="">Select employee</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Department
          <select className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="department" required>
            <option value="">Select department</option>
            <option value="Production">Production</option>
            <option value="Inventory">Inventory</option>
            <option value="Finance">Finance</option>
            <option value="Sales">Sales</option>
            <option value="Logistics">Logistics</option>
            <option value="Quality">Quality</option>
            <option value="HR">HR</option>
            <option value="Admin">Admin</option>
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Priority
          <select className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="priority">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Subject
          <input className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="subject" required />
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Approver (reporting manager)
          <select className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="approver_id">
            <option value="">Auto (reporting manager)</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold text-[#334536]">
          Assigned to
          <select className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="assigned_to">
            <option value="">None</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
          </select>
        </label>
      </div>
      <label className="text-sm font-semibold text-[#334536]">
        Description
        <textarea className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm" name="description" rows={3} />
      </label>
      {message ? <p className={`rounded-2xl px-4 py-3 text-sm ${failed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"}`}>{message}</p> : null}
      <button className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:opacity-60" disabled={loading} type="submit">
        {loading ? "Creating…" : "Raise ticket"}
      </button>
    </form>
  );
}
