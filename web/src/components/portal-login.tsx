import Link from "next/link";
import { HighlightList } from "./highlight-list";
import { LoginForm } from "./login-form";
import { portalConfig, type Portal } from "../lib/portal-config";

export function PortalLogin({ portal }: { portal: Portal }) {
  const config = portalConfig[portal];

  return (
    <main className="min-h-screen bg-[#f5f7f2] px-5 py-8 text-[#15221b] sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-12 lg:flex-row lg:items-center lg:justify-between">
        <section className="max-w-xl">
          <Link className="inline-flex items-center gap-3 text-sm font-bold tracking-[0.18em]" href="/">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d8f35b] text-xl text-[#15221b]">
              Q
            </span>
            QSA INDUSTRIES
          </Link>
          <p className="mt-20 text-xs font-bold uppercase tracking-[0.24em] text-[#6f8c3b]">
            Secure workspace
          </p>
          <h1 className="mt-5 text-5xl font-semibold leading-none tracking-[-0.055em] sm:text-6xl">
            {config.title}
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-[#5d6b60]">{config.description}</p>
          {/* Same treatment as the in-portal headers: the headline sells the
              workspace, the bullet list is reference. Collapsed here too, because this
              screen's job is to get somebody to the login form, and the list was pushing
              it below the fold on a laptop. */}
          <HighlightList className="mt-8 max-w-md" items={config.highlights} />
          <p className="mt-8 max-w-md text-sm leading-6 text-[#718075]">
            Accounts are provisioned by QSA administration. Access follows your assigned role and reporting scope.
          </p>
        </section>
        <section className="w-full max-w-md rounded-[2rem] border border-[#dfe6dc] bg-white p-6 shadow-[0_24px_70px_rgba(21,34,27,0.1)] sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6f8c3b]">Portal access</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">Welcome back</h2>
            </div>
            <span className="h-3 w-3 rounded-full bg-[#7bb51d]" />
          </div>
          <LoginForm portal={portal} />
          <Link className="mt-6 block text-center text-sm font-semibold text-[#4f6254] hover:text-[#15221b]" href="/login">
            Choose another portal
          </Link>
        </section>
      </div>
    </main>
  );
}
