"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { roleLabel } from "../lib/org-tree";
import type { DesignationRow } from "../lib/data";
import { PdfHelp } from "./pdf-help";

type Props = {
  managers: Array<{ id: string; full_name: string; role: string }>;
  designations: DesignationRow[];
};

// The screen that did not exist: creating the login itself.
//
// The admin screen could change a user's name, role, active flag and reporting
// line, and said so on the panel below it: "Account creation is not on this screen
// and cannot be. It needs the service role key." The key must never reach a
// browser, which is true, and it left the first thing an admin does on day one with
// no way to do it.
//
// It no longer needs an edge function either. public.admin_create_user_account is
// SECURITY DEFINER: the browser calls it with the admin's own session token, the
// function re-reads the caller's role from the JWT inside the database, and the
// service role key is never involved at all. The call goes straight to PostgREST,
// so provisioning works on any deployment where the migrations have been applied,
// with no function to deploy and nothing that can drift out of step.
//
// The password is typed by the admin and goes straight to Auth. It is not stored
// here, not echoed back, and not recoverable afterwards, so the field is cleared on
// success and the message says so. There is no reset link in this screen on
// purpose: sending a new password by email is how a shared secret ends up in an
// inbox, and the application's own recovery flow is the way to do that.
export function StaffLoginForm({ managers, designations }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("production_manager");
  const [designationId, setDesignationId] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [managerId, setManagerId] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Which manager a role may name is the rule in admin_upsert_user_profile, not
  // here, and the same rule drives the picker in the user directory form above. It
  // is restated only to keep the admin from sending a shape the database will
  // refuse; the database is what decides.
  const wantedManagerRole =
    role === "sales_rep" ? "sales_manager" : role === "sales_manager" ? "sales_director" : null;
  const eligibleManagers = wantedManagerRole
    ? managers.filter((manager) => manager.role === wantedManagerRole)
    : [];

  const effectiveManagerId = eligibleManagers.some((manager) => manager.id === managerId)
    ? managerId
    : "";

  // Mirrors the database constraints, so the button greys out instead of the round
  // trip coming back with an error about a field the admin can see is empty. The
  // designation is no longer free text, so the only thing left to mirror here is
  // the phone; the title is a catalogue row and the picker can only offer rows.
  const phoneTooLong = phone.trim().length > 32;

  const canSubmit =
    fullName.trim() !== "" &&
    email.trim() !== "" &&
    password.length >= 8 &&
    !phoneTooLong &&
    (wantedManagerRole === null || effectiveManagerId !== "");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage("");
    setFailed(false);
    setLoading(true);

    const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p_email: email.trim(), p_full_name: fullName.trim(), p_password: password, p_role: role, p_designation_id: designationId || null, p_phone: phone.trim() || null, p_is_active: true, p_manager_id: wantedManagerRole ? effectiveManagerId || null : null }) });
    const json = await res.json();
    const error = res.ok ? null : { message: json.error ?? "Failed" };
    setLoading(false);
    if (error) {
      setMessage(error.message);
      setFailed(true);
      return;
    }

    setPassword("");
    setFullName("");
    setEmail("");
    setDesignationId("");
    setPhone("");
    setMessage(
      "Login created. Give the password to this person directly; it is not stored here and cannot be shown again.",
    );
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="flex justify-end"><PdfHelp guide="24-staff-login" /></div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">
          Full name
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setFullName(event.target.value)}
            value={fullName}
          />
          <span className="mt-2 block text-xs font-normal text-[#718075]">
            This is the name the org chart will show on their post.
          </span>
        </label>

        <label className="text-sm font-semibold text-[#334536]">
          Login email
          <input
            autoComplete="off"
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
          <span className="mt-2 block text-xs font-normal text-[#718075]">
            The login id. An address that already has an account is refused rather than reused.
          </span>
        </label>

        <label className="text-sm font-semibold text-[#334536]">
          Role
          <select
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
            onChange={(event) => setRole(event.target.value)}
            value={role}
          >
            <option value="admin">Admin</option>
            <option value="production_manager">Production manager</option>
            <option value="inventory_manager">Inventory manager</option>
            <option value="qc_staff">QC staff</option>
            <option value="sales_director">Sales director</option>
            <option value="sales_manager">Sales manager</option>
            <option value="sales_rep">Sales rep</option>
            <option value="logistics">Logistics</option>
            <option value="finance">Finance</option>
          </select>
          <span className="mt-2 block text-xs font-normal text-[#718075]">
            The role decides what this account may do. Their job title on the org chart is a separate thing.
          </span>
        </label>

        {wantedManagerRole ? (
          <label className="text-sm font-semibold text-[#334536]">
            Reports to
            <select
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
              onChange={(event) => setManagerId(event.target.value)}
              value={effectiveManagerId}
            >
              <option value="">Select a {wantedManagerRole.replace(/_/g, " ")}</option>
              {eligibleManagers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.full_name}
                </option>
              ))}
            </select>
            {effectiveManagerId === "" ? (
              <span className="mt-2 block text-xs font-normal text-[#a33a2b]">
                A {roleLabel(role).toLowerCase()} must report to an active{" "}
                {wantedManagerRole.replace(/_/g, " ")}.
              </span>
            ) : null}
          </label>
        ) : null}

<label className="text-sm font-semibold text-[#334536]">
          Job title
          <select
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
            onChange={(event) => setDesignationId(event.target.value)}
            value={designationId}
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
            Optional, and chosen from the catalogue rather than typed. Shown under the name on the org
            chart. The role above is what the policies switch on today; this is what it says on their name
            card, and it is what the roles and permissions screen will switch on.
          </span>
        </label>

        <label className="text-sm font-semibold text-[#334536]">
          Phone
          <input
            autoComplete="off"
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            inputMode="tel"
            maxLength={32}
            onChange={(event) => setPhone(event.target.value)}
            value={phone}
          />
          <span className="mt-2 block text-xs font-normal text-[#718075]">
            Optional. Up to 32 characters, stored as typed.
          </span>
        </label>

        <label className="text-sm font-semibold text-[#334536]">
          Initial password
          <input
            autoComplete="new-password"
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
          <span className="mt-2 block text-xs font-normal text-[#a33a2b]">
            At least 8 characters. Hand it over in person. There is no way to read it back later.
          </span>
        </label>
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

      <button
        className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={loading || !canSubmit}
        type="submit"
      >
        {loading ? "Creating…" : "Create the login"}
      </button>

      <p className="text-xs text-[#718075]">
        Dealer logins are not made here. They carry a credit decision and a sales rep, so they are created
        from{" "}
        <span className="font-semibold text-[#4f6254]">Dealer onboarding</span> instead. Once a login
        exists it can be edited in the list below this panel, and a person can be put on a post from the
        organization chart.
      </p>
    </form>
  );
}
