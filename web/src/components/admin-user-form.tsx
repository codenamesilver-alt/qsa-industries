"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import type { UserDirectoryRow } from "../lib/data";

type Props = {
  user: UserDirectoryRow;
  dealers: Array<{ id: string; name: string }>;
  managers: Array<{ id: string; full_name: string; role: string }>;
};

// One call changes the name, the role, the active flag, the dealer link and the
// reporting line together. Splitting them into separate updates is what let the
// profile and the hierarchy disagree, so admin_upsert_user_profile refuses to be
// driven piecemeal and this form does not offer the option.
export function AdminUserForm({ user, dealers, managers }: Props) {
  const router = useRouter();
  const [fullName, setFullName] = useState(user.full_name);
  const [role, setRole] = useState(user.role);
  const [isActive, setIsActive] = useState(user.is_active);
  const [dealerId, setDealerId] = useState(user.dealer_id ?? "");
  const [managerId, setManagerId] = useState(user.manager_id ?? "");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

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
  const canSubmit =
    fullName.trim() !== "" &&
    (wantedManagerRole === null || effectiveManagerId !== "") &&
    (role !== "dealer" || dealerId !== "");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage("");
    setFailed(false);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("admin_upsert_user_profile", {
      p_user_id: user.user_id,
      p_full_name: fullName.trim(),
      p_role: role,
      p_is_active: isActive,
      p_dealer_id: role === "dealer" ? dealerId || null : null,
      p_manager_id: wantedManagerRole ? effectiveManagerId || null : null,
    });
    setLoading(false);
    if (error) {
      setMessage(error.message);
      setFailed(true);
      return;
    }
    setMessage("User updated.");
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
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
      </div>

      <label className="flex items-center gap-2 text-sm text-[#334536]">
        <input checked={isActive} onChange={(event) => setIsActive(event.target.checked)} type="checkbox" />
        Account is active
      </label>

      <p className="text-xs text-[#5d6b60]">
        Suspending an account is refused while active accounts still report to it, and the last active admin
        cannot be demoted. Account creation stays out of band: it needs the service role key.
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
    </form>
  );
}
