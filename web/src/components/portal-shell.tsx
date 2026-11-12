import Link from "next/link";
import { roleLabel, type Profile } from "../lib/auth";
import { HighlightList } from "./highlight-list";
import { PortalNav } from "./portal-nav";
import { SidebarNavScroll } from "./sidebar-nav-scroll";
import { SignOutButton } from "./sign-out-button";
import { ChatbotWidget } from "./chatbot-widget";

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
    <main className="min-h-screen bg-[#f2f3ed] text-[#27312d]">
      <div className="app mx-auto grid min-h-screen max-w-[1800px] grid-cols-1 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="sidebar flex flex-col gap-4 border-b border-[rgba(200,205,196,0.45)] bg-[#f2f3ed] px-4 py-5 sm:px-6 lg:h-screen lg:sticky lg:top-0 lg:overflow-hidden lg:border-b-0 lg:border-r lg:px-[18px] lg:py-6">
          <Link className="brand flex shrink-0 items-center gap-3 px-2 py-1" href="/">
            <span className="brandmark grid h-9 w-9 place-items-center rounded-xl bg-[#baff48] text-[#263520] shadow-[4px_4px_10px_#d9dcd5,-4px_-4px_10px_#fff]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M4 17.5 12 4l8 13.5H4Z" />
                <path d="M8 17.5 12 11l4 6.5" />
              </svg>
            </span>
            <span>
              <strong className="block font-[800] text-[18px] tracking-[-0.6px] font-[Manrope,sans-serif]">QSA ERP</strong>
              <small className="block text-[10px] uppercase tracking-[1.6px] text-[#84908a]">Business suite</small>
            </span>
          </Link>
          <div className="workspace flex shrink-0 items-center gap-2.5 rounded-[14px] bg-[#f2f3ed] px-3.5 py-3 shadow-[inset_4px_4px_9px_#d9dcd5,inset_-4px_-4px_9px_#fff]">
            <span className="workspace-icon grid h-8 w-8 place-items-center rounded-[10px] bg-[#e3ece4] font-bold text-[#58765d]">Q</span>
            <span className="workspace-copy flex-1">
              <b className="block text-[12px]">QSA Industries</b>
              <small className="text-[10px] text-[#84908a]">Enterprise plan</small>
            </span>
          </div>
          <section className="nav-section flex min-h-0 flex-1 flex-col">
            <p className="nav-label mb-2 shrink-0 px-3 text-[10px] font-bold uppercase tracking-[1.4px] text-[#a0a9a2]">Workspace</p>
            <SidebarNavScroll>
              <PortalNav profile={profile} />
            </SidebarNavScroll>
          </section>
          <div className="sidebar-bottom shrink-0 flex flex-col gap-3">
            <div className="help-card rounded-[14px] bg-[#f2f3ed] p-3 shadow-[var(--raised-sm)]">
              <a
                className="flex items-center gap-2 text-sm font-bold text-[#25311f]"
                href="https://wa.me/918009804786"
                rel="noopener noreferrer"
                target="_blank"
              >
                <svg aria-hidden height="16" viewBox="0 0 24 24" width="16" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                Whatsapp me for help
              </a>
            </div>
            <div className="user-mini flex items-center gap-3">
              <span className="avatar grid h-9 w-9 place-items-center rounded-full bg-[#baff48] text-xs font-bold text-[#263520]">{initials}</span>
              <div className="min-w-0 flex-1">
                <b className="block truncate text-sm">{profile.full_name}</b>
                <small className="text-xs text-[#84908a]">{roleLabel(profile.role)}</small>
              </div>
              <SignOutButton />
            </div>
          </div>
        </aside>
        <div className="min-w-0 px-5 py-6 sm:px-8">
          <header className="topbar mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="crumb text-sm text-[#84908a]">
                Workspace / <b className="text-[#27312d]">{eyebrow}</b>
              </div>
            </div>
            <div className="top-actions flex items-center gap-2">
              <form action="/search" className="search flex h-10 items-center gap-2 rounded-[12px] bg-[#f2f3ed] px-3 shadow-[var(--inset)]" method="get">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-[#84908a]">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m16 16 4 4" />
                </svg>
                <input className="w-[200px] bg-transparent text-sm outline-none placeholder:text-[#84908a]" name="q" placeholder="Search anything…" aria-label="Search" />
                <button className="text-[#84908a]" type="submit" aria-label="Search submit">Go</button>
              </form>
              <button className="icon-btn grid h-10 w-10 place-items-center rounded-[12px] bg-[#f2f3ed] shadow-[var(--raised-sm)]" aria-label="Notifications">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4" />
                </svg>
              </button>
              <div className="profile flex items-center gap-2">
                <span className="avatar grid h-9 w-9 place-items-center rounded-full bg-[#baff48] text-xs font-bold text-[#263520]">{initials}</span>
                <div className="profile-copy hidden sm:block">
                  <b className="block text-sm">{profile.full_name}</b>
                  <small className="text-xs text-[#84908a]">{roleLabel(profile.role)}</small>
                </div>
              </div>
            </div>
          </header>
          <section className="heading mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="eyebrow text-[11px] font-bold uppercase tracking-[0.24em] text-[#6f8c3b]">{eyebrow}</div>
              <h1 className="mt-2 text-3xl font-semibold leading-none tracking-[-0.04em] sm:text-4xl">{title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5d6b60]">{description}</p>
              <HighlightList items={highlights} />
            </div>
          </section>
          <div className="mx-auto max-w-7xl">{children}</div>
        </div>
      </div>
      <ChatbotWidget />
</main>
  );
}