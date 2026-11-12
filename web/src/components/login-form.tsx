"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { admitsRole } from "../lib/roles";
import { portalConfig, type Portal } from "../lib/portal-config";

export function LoginForm({ portal }: { portal: Portal }) {
  const router = useRouter();
  const config = portalConfig[portal];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("qsa_remember");
      if (saved) {
        const { email: e, password: p } = JSON.parse(saved);
        if (e) setEmail(e);
        if (p) setPassword(p);
        setRemember(true);
      }
    } catch {}
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    if (remember) {
      try { localStorage.setItem("qsa_remember", JSON.stringify({ email, password })); } catch {}
    } else {
      try { localStorage.removeItem("qsa_remember"); } catch {}
    }

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "Unable to sign in.");
      setLoading(false);
      return;
    }

    const profile = json.profile;
    if (!profile || !admitsRole(profile.role, config.allowedRoles)) {
      await fetch("/api/auth/logout", { method: "POST" });
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
      <div className="flex items-center gap-2">
        <input
          checked={remember}
          className="h-4 w-4 rounded border-[#d6e1ce] text-[#6f8c3b] focus:ring-[#d8f35b]"
          id="remember"
          name="remember"
          onChange={(event) => setRemember(event.target.checked)}
          type="checkbox"
        />
        <label className="text-sm font-medium text-[#334536]" htmlFor="remember">
          Remember me
        </label>
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
