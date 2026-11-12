"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserDirectoryRow } from "../lib/data";
import { PdfHelp } from "./pdf-help";

type Props = {
  user: UserDirectoryRow;
};

// The super admin account, deliberately not the employee form.
//
// AdminUserForm is the wrong tool here and using it would be a quiet violation of
// what this account is. It offers a role picker, a designation picker, a phone field,
// a reporting line and an active flag, and it can therefore turn the super admin into
// an employee: pick a staff role, save, and the account is on the org chart with a
// job title, exactly what it is meant never to be.
//
// So this form offers the one thing the super admin actually needs in order to keep
// running the portal: a password reset. Name, role, designation, manager and phone
// are employee attributes and are not editable here, because a portal super admin has
// none of them. The email address is fixed at the account level.
export function SuperAdminForm({ user }: Props) {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  const canResetPassword = newPassword.length >= 8;

  async function handlePasswordReset() {
    if (!canResetPassword || loading) return;
    setMessage("");
    setFailed(false);
    setLoading(true);
    const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ p_user_id: user.user_id, p_password: newPassword }) });
    const json = await res.json();
    const error = res.ok ? null : { message: json.error ?? "Failed" };
    setLoading(false);
    if (error) {
      setMessage(error.message);
      setFailed(true);
      return;
    }
    setNewPassword("");
    setMessage(
      "Password reset. Hand the new one over directly; it is not stored here and cannot be shown again.",
    );
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-[#718075]">Email</dt>
          <dd className="mt-1 text-sm text-[#334536]">{user.email}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-[#718075]">Account</dt>
          <dd className="mt-1 text-sm text-[#334536]">
            Super admin &middot; portal maintenance &middot; not an employee
          </dd>
        </div>
      </dl>

      <p className="text-xs text-[#718075]">
        This login exists to run the portal. It carries no job title, no reporting line and no
        place on the organization chart, and there is nothing to edit here beyond the password,
        because an employee profile is exactly what it must never acquire.
      </p>

      <div className="rounded-2xl border border-[#d6e1ce] bg-[#f7faf3] p-4">
        <p className="text-sm font-semibold text-[#334536]">Reset this account&rsquo;s password</p>
        <label className="mt-2 block text-xs text-[#5c6b60]" htmlFor={`super-admin-password-${user.user_id}`}>
          New password
        </label>
        <input
          autoComplete="new-password"
          className="mt-1 w-full rounded-xl border border-[#d6e1ce] bg-white px-3 py-2 text-sm"
          id={`super-admin-password-${user.user_id}`}
          onChange={(event) => setNewPassword(event.target.value)}
          type="password"
          value={newPassword}
        />
        <p className="mt-1 text-xs text-[#718075]">At least 8 characters. This replaces the current one immediately.</p>

        {message ? (
          <p
            className={
              failed
                ? "mt-3 rounded-xl bg-[#fff0ed] px-3 py-2 text-xs text-[#a33a2b]"
                : "mt-3 rounded-xl bg-[#eef6df] px-3 py-2 text-xs text-[#4e741d]"
            }
            role="status"
          >
            {message}
          </p>
        ) : null}

        <button
          className="mt-3 rounded-full bg-[#24401f] px-4 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canResetPassword || loading}
          onClick={handlePasswordReset}
          type="button"
        >
          {loading ? "Resetting…" : "Reset password"}
        </button>
      </div>
    </div>
  );
}
