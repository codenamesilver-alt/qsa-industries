import Link from "next/link";
import { portalConfig, type Portal } from "../../lib/portal-config";

// The chooser reads the same table the login screens and the role routing do,
// rather than keeping its own copy of the three names and descriptions. It used
// to, and the two had already drifted: this page described dealers as part of the
// sales portal, which they are not, they have their own.
const accents: Record<Portal, string> = {
  internal: "bg-[#15221b] text-[#d8f35b]",
  sales: "bg-[#e5efd9] text-[#4f6254]",
  dealer: "bg-[#d8f35b] text-[#15221b]",
};

export default function LoginPage() {
  const portals = Object.entries(portalConfig) as Array<[Portal, (typeof portalConfig)[Portal]]>;

  return (
    <main className="min-h-screen bg-[#f5f7f2] px-5 py-8 text-[#15221b] sm:px-8">
      <div className="mx-auto max-w-6xl">
        <Link className="inline-flex items-center gap-3 text-sm font-bold tracking-[0.18em]" href="/">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d8f35b] text-xl">
            Q
          </span>
          QSA INDUSTRIES
        </Link>
        <section className="pb-10 pt-20 sm:pt-28">
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-[#6f8c3b]">Role-aware access</p>
          <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-none tracking-[-0.055em] sm:text-7xl">
            Choose your workspace.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-[#5d6b60]">
            One operating core. Three focused portals. Each account sees only the data allowed by its role.
          </p>
        </section>
        <section className="grid gap-5 md:grid-cols-3">
          {portals.map(([portal, config]) => (
            <Link
              className="group rounded-[2rem] border border-[#dfe6dc] bg-white p-7 transition hover:-translate-y-1 hover:shadow-[0_24px_70px_rgba(21,34,27,0.1)]"
              href={`/login/${portal}`}
              key={portal}
            >
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${accents[portal]}`}>
                Secure portal
              </span>
              <h2 className="mt-16 text-2xl font-semibold tracking-[-0.04em]">{config.title}</h2>
              <p className="mt-3 text-sm leading-6 text-[#718075]">{config.description}</p>
              <span className="mt-8 block text-sm font-bold text-[#4f6254] group-hover:text-[#15221b]">
                Continue →
              </span>
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}