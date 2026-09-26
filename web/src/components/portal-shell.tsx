import Link from "next/link";
import { roleLabel, type Profile } from "../lib/auth";
import { PortalNav } from "./portal-nav";
import { SignOutButton } from "./sign-out-button";

type PortalShellProps = {
  profile: Profile;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
};

export function PortalShell({ profile, eyebrow, title, description, children }: PortalShellProps) {
  return (
    <main className="min-h-screen bg-[#f5f7f2] px-5 py-8 text-[#15221b] sm:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-5 border-b border-[#dfe6dc] pb-6 sm:flex-row sm:items-center sm:justify-between">
          <Link className="inline-flex items-center gap-3 text-sm font-bold tracking-[0.18em]" href="/">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d8f35b] text-xl">
              Q
            </span>
            QSA INDUSTRIES
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-full border border-[#d6e1ce] bg-white px-4 py-2 text-xs font-semibold text-[#4f6254]">
              Logged in as <span className="font-bold text-[#15221b]">{roleLabel(profile.role)}</span>
            </div>
            <SignOutButton />
          </div>
        </header>
        <PortalNav profile={profile} />
        <section className="grid gap-10 pb-12 pt-8 lg:grid-cols-[1fr_0.8fr] lg:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#6f8c3b]">{eyebrow}</p>
            <h1 className="mt-5 text-5xl font-semibold leading-none tracking-[-0.055em] sm:text-6xl">{title}</h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#5d6b60]">{description}</p>
          </div>
          <div className="rounded-[2rem] bg-[#15221b] p-7 text-white shadow-[0_24px_70px_rgba(21,34,27,0.16)]">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#b6d96b]">Account</p>
            <p className="mt-4 text-2xl font-semibold">{profile.full_name}</p>
            <p className="mt-2 text-sm text-[#c4d0c5]">{profile.email}</p>
            <div className="mt-7 border-t border-white/15 pt-5 text-sm text-[#d5dfd5]">
              Role scope active: {roleLabel(profile.role)}
            </div>
          </div>
        </section>
        {children}
      </div>
    </main>
  );
}
