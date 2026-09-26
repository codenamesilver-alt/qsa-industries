"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      className="rounded-full border border-[#d6e1ce] bg-white px-4 py-2 text-xs font-bold text-[#4f6254] transition hover:border-[#9db56a] hover:text-[#15221b] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={loading}
      onClick={handleSignOut}
      type="button"
    >
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}
