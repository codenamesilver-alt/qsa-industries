import Link from "next/link";
import { roleLabel, type Profile } from "../lib/auth";
import { HighlightList } from "./highlight-list";
import { PortalNav } from "./portal-nav";
import { SignOutButton } from "./sign-out-button";

type PortalShellProps = {
  profile: Profile;
  eyebrow: string;
  title: string;
  description: string;
  highlights: readonly string[];
  children: React.ReactNode;
};

export function PortalShell({
  profile,
  eyebrow,
  title,
  description,
  highlights,
  children,
}: PortalShellProps) {
  const initials = profile.full_name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <main className="min-h-screen bg-[#f5f7f2] text-[#15221b]">
      <div className="lg:flex">
        <aside className="flex flex-col gap-8 border-b border-[#dfe6dc] bg-white px-5 py-8 sm:px-8 lg:h-screen lg:w-72 lg:shrink-0 lg:sticky lg:top-0 lg:border-b-0 lg:border-r">
          <Link className="inline-flex items-center gap-3 text-sm font-bold tracking-[0.18em]" href="/">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d8f35b] text-xl">
              Q
            </span>
            QSA INDUSTRIES
          </Link>
          <PortalNav profile={profile} />
          <div className="flex flex-wrap items-center gap-3 lg:mt-auto lg:flex-col lg:items-stretch">
            <div className="rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-xs font-semibold text-[#4f6254]">
              Logged in as
              <span className="mt-1 block font-bold text-[#15221b]">{roleLabel(profile.role)}</span>
            </div>
            <SignOutButton />
          </div>
        </aside>
        <div className="min-w-0 px-5 py-8 sm:px-8">
          <div className="mx-auto max-w-7xl">
            <section className="grid gap-6 pb-6 lg:grid-cols-[1fr_auto] lg:items-start">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#6f8c3b]">{eyebrow}</p>
                <h1 className="mt-2 text-3xl font-semibold leading-none tracking-[-0.04em] sm:text-4xl">
                  {title}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5d6b60]">{description}</p>
                {/* The eyebrow, headline and description are the page. The highlights are
                    a list of what the page holds, which is reference rather than content,
                    so it sits behind a link instead of pushing the first panel down. */}
                <HighlightList items={highlights} />
              </div>
              <div className="flex max-w-sm items-center gap-3 rounded-2xl bg-[#15221b] px-4 py-3 text-white shadow-[0_16px_40px_rgba(21,34,27,0.16)]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#d8f35b] text-xs font-bold text-[#15221b]">
                  {initials}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold leading-tight">{profile.full_name}</p>
                  <p className="truncate text-xs text-[#c4d0c5]">{profile.email}</p>
                  <p className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[#b6d96b]">
                    {roleLabel(profile.role)}
                  </p>
                </div>
              </div>
            </section>
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}
