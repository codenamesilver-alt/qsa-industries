"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import { type UserRole } from "../lib/auth";
import { portalConfig, type Portal } from "../lib/portal-config";

export function LoginForm({ portal }: { portal: Portal }) {
  const router = useRouter();
  const config = portalConfig[portal];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data.user) {
      setError(signInError?.message ?? "Unable to sign in.");
      setLoading(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profileError || !profile || !config.allowedRoles.includes(profile.role as UserRole)) {
      await supabase.auth.signOut();
      setError("This account is not provisioned for this portal.");
      setLoading(false);
      return;
    }

    router.replace(config.destination);
    router.refresh();
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
      <div>
        <label className="block text-sm font-semibold text-[#334536]" htmlFor="email">
          Work email
        </label>
        <input
          autoComplete="email"
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#6f8c3b] focus:ring-4 focus:ring-[#d8f35b]/40"
          id="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </div>
      <div>
        <label className="block text-sm font-semibold text-[#334536]" htmlFor="password">
          Password
        </label>
        <input
          autoComplete="current-password"
          className="mt-2 w-full rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm outline-none transition focus:border-[#6f8c3b] focus:ring-4 focus:ring-[#d8f35b]/40"
          id="password"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </div>
      {error ? (
        <p aria-live="polite" className="rounded-2xl bg-[#fff0ed] px-4 py-3 text-sm font-medium text-[#a33a2b]">
          {error}
        </p>
      ) : null}
      <button
        className="w-full rounded-2xl bg-[#15221b] px-4 py-3 text-sm font-bold text-[#d8f35b] transition hover:bg-[#263a2d] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={loading}
        type="submit"
      >
        {loading ? "Signing in…" : `Sign in to ${config.title}`}
      </button>
    </form>
  );
}
