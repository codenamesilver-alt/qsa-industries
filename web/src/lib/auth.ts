import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

// Mirrors public.user_role in the database. qc_staff was added there in
// 20260926093100 and was missing from this list, so a QC user authenticated
// successfully and then had no role that matched anywhere in the app.
export const userRoles = [
  "admin",
  "production_manager",
  "inventory_manager",
  "qc_staff",
  "sales_rep",
  "sales_manager",
  "sales_director",
  "logistics",
  "finance",
  "dealer",
] as const;

export type UserRole = (typeof userRoles)[number];

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  dealer_id: string | null;
};

const profileSelect = "id, full_name, email, role, dealer_id";

export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    if (userError.name === "AuthSessionMissingError") {
      return null;
    }

    throw userError;
  }

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("users")
    .select(profileSelect)
    .eq("id", user.id)
    .single();

  if (error) {
    throw error;
  }

  return data as Profile;
}

export async function requireProfile(allowedRoles: readonly UserRole[]) {
  const profile = await getProfile();

  if (!profile) {
    redirect("/login");
  }

  if (!allowedRoles.includes(profile.role)) {
    // Not the marketing homepage: that reads as "you are signed out" even though
    // the session is perfectly valid, which made an ordinary permission mistake
    // look like a broken login.
    redirect("/unauthorized");
  }

  return profile;
}

export function roleLabel(role: UserRole) {
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
