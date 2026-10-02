import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { admitsRole, type UserRole } from "./roles";

// The role vocabulary and the guard predicates live in ./roles, which imports
// nothing server-only. This module reaches next/headers, so client components must
// take roles from ./roles and never from here.
export { admitsRole, isSuperuser, superuserRoles, userRoles, type UserRole } from "./roles";

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

  if (!admitsRole(profile.role, allowedRoles)) {
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
