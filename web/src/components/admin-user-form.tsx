"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PdfHelp } from "./pdf-help";
import type { DesignationRow, UserDirectoryRow } from "../lib/data";

type Props = {
  user: UserDirectoryRow;
  dealers: Array<{ id: string; name: string }>;
  managers: Array<{ id: string; full_name: string; role: string }>;
  designations: DesignationRow[];
};

// One call changes the name, the role, the active flag, the dealer link and the
// reporting line together. Splitting them into separate updates is what let the
// profile and the hierarchy disagree, so admin_upsert_user_profile refuses to be
// driven piecemeal and this form does not offer the option.
export function AdminUserForm({ user, dealers, managers, designations }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState(user.full_name);
  const [role, setRole] = useState(user.role);
  const [designationId, setDesignationId] = useState(user.designation_id ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [isActive, setIsActive] = useState(user.is_active);
  const [dealerId, setDealerId] = useState(user.dealer_id ?? "");
  const [managerId, setManagerId] = useState(user.manager_id ?? "");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  // The password reset is a second, separate call on purpose. admin_upsert_user_profile
  // is the profile write, and mixing a credential change into it would mean a
  // mistyped name field could silently invalidate somebody's login.
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordFailed, setPasswordFailed] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  // The hierarchy is three fixed levels deep, so the parent each role may name is
  // determined by the role rather than chosen freely. Offering every user as a
  // manager for every user would let the form send a shape the database rejects.
  const wantedManagerRole = role === "sales_rep" ? "sales_manager" : role === "sales_manager" ? "sales_director" : null;
  const eligibleManagers = wantedManagerRole
    ? managers.filter((manager) => manager.role === wantedManagerRole)
    : [];

  // A manager is only kept if the current role may report to them. Changing the
  // role in the picker therefore drops an incompatible manager without the state
  // being rewritten underneath the form: a rep promoted to manager would
  // otherwise still be holding their old manager id, which the save would be
  // refused for and which the picker no longer shows. Deriving beats an effect
  // here because the invalid value never has to exist.
  const effectiveManagerId = eligibleManagers.some((manager) => manager.id === managerId) ? managerId : "";

  // Blank is sent as null on both of these, so clearing a field in the UI clears the
  // column rather than storing padding. The designation is a catalogue reference
  // rather than free text as of 20261003100000, so there is nothing to mirror about its
  // length here: the picker can only offer rows that exist.
  const phoneTooLong = phone.trim().length > 32;
  const canSubmit =
    fullName.trim() !== "" &&
    !phoneTooLong &&
    (wantedManagerRole === null || effectiveManagerId !== "") &&
    (role !== "dealer" || dealerId !== "");

  const canResetPassword = newPassword.length >= 8;

  async function handlePasswordReset() {
    if (!canResetPassword || passwordLoading) return;
    setPasswordMessage("");
    setPasswordFailed(false);
    setPasswordLoading(true);
    const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p_user_id: user.user_id, p_password: newPassword }) });
    const json = await res.json();
    setPasswordLoading(false);
    if (!res.ok) {
      setPasswordMessage(json.error ?? "Failed");
      setPasswordFailed(true);
      return;
    }
    setNewPassword("");
    setPasswordMessage(
      "Password reset. Hand the new one over directly; it is not stored here and cannot be shown again.",
    );
    router.refresh();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage("");
    setFailed(false);
    setLoading(true);
    const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p_user_id: user.user_id, p_full_name: fullName.trim(), p_role: role, p_is_active: isActive, p_dealer_id: role === "dealer" ? dealerId || null : null, p_manager_id: wantedManagerRole ? effectiveManagerId || null : null, p_designation_id: designationId || null, p_phone: phone.trim() || null }) });
    const json = await res.json();
    setLoading(false);
    if (!res.ok) {
      setMessage(json.error ?? "Failed");
      setFailed(true);
      return;
    }
    setMessage("User updated.");
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="flex justify-end">
        <PdfHelp guide="03-admin-users" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm font-semibold text-[#334536]">
          Full name
          <input
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setFullName(event.target.value)}
            value={fullName}
          />
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
            <option value="dealer">Dealer</option>
          </select>
        </label>

        {role === "dealer" ? (
          <label className="text-sm font-semibold text-[#334536]">
            Linked dealer
            <select
              className="mt-2 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm font-normal"
              onChange={(event) => setDealerId(event.target.value)}
              value={dealerId}
            >
              <option value="">Select a dealer</option>
              {dealers.map((dealer) => (
                <option key={dealer.id} value={dealer.id}>
                  {dealer.name}
                </option>
              ))}
            </select>
            {dealerId === "" ? (
              <span className="mt-2 block text-xs font-normal text-[#a33a2b]">
                A dealer account must be linked to a dealer.
              </span>
            ) : null}
          </label>
        ) : null}

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
                A {role.replace(/_/g, " ")} must report to an active {wantedManagerRole.replace(/_/g, " ")}.
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
            chart, separate from the role above.
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
        </label>
      </div>

      <label className="flex items-center gap-2 text-sm text-[#334536]">
        <input checked={isActive} name="isActive" onChange={(event) => setIsActive(event.target.checked)} type="checkbox" />
        Account is active
      </label>

      <p className="text-xs text-[#5d6b60]">
        Suspending an account is refused while active accounts still report to it, and the last active admin
        cannot be demoted. A new login is made in{" "}
        <span className="font-semibold text-[#4f6254]">Create a staff login</span> above, and changing an
        existing password is a separate step below.
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
        {loading ? "Saving…" : "Save user"}
      </button>

      <div className="space-y-3 rounded-2xl border border-[#d6e1ce] p-4">
        <p className="text-sm font-semibold text-[#334536]">Reset this person&rsquo;s password</p>
        <label className="block text-sm font-semibold text-[#334536]">
          New password
          <input
            autoComplete="new-password"
            className="mt-2 w-full rounded-xl border border-[#d6e1ce] px-3 py-2 text-sm font-normal"
            onChange={(event) => setNewPassword(event.target.value)}
            type="password"
            value={newPassword}
          />
          <span className="mt-2 block text-xs font-normal text-[#a33a2b]">
            At least 8 characters. This replaces their current password immediately.
          </span>
        </label>
        {passwordMessage ? (
          <p
            className={`rounded-2xl px-4 py-3 text-sm ${
              passwordFailed ? "bg-[#fff0ed] text-[#a33a2b]" : "bg-[#eef6df] text-[#4e741d]"
            }`}
          >
            {passwordMessage}
          </p>
        ) : null}
        <button
          className="rounded-2xl border border-[#15221b] px-5 py-2 text-sm font-bold text-[#15221b] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={passwordLoading || !canResetPassword}
          onClick={handlePasswordReset}
          type="button"
        >
          {passwordLoading ? "Resetting…" : "Reset password"}
        </button>
      </div>
    </form>
  );
}
