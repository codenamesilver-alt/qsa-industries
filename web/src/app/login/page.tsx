import Link from "next/link";

const portals = [
  {
    href: "/login/internal",
    title: "Internal operations",
    description: "Production, inventory, logistics, finance, and administration.",
    accent: "bg-[#15221b] text-[#d8f35b]",
  },
  {
    href: "/login/sales",
    title: "Sales management",
    description: "Sales reps, managers, directors, dealers, and approvals.",
    accent: "bg-[#e5efd9] text-[#4f6254]",
  },
  {
    href: "/login/dealer",
    title: "Dealer portal",
    description: "Dealer profile, catalog pricing, orders, and account visibility.",
    accent: "bg-[#d8f35b] text-[#15221b]",
  },
];

export default function LoginPage() {
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
          {portals.map((portal) => (
            <Link
              className="group rounded-[2rem] border border-[#dfe6dc] bg-white p-7 transition hover:-translate-y-1 hover:shadow-[0_24px_70px_rgba(21,34,27,0.1)]"
              href={portal.href}
              key={portal.href}
            >
              <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${portal.accent}`}>
                Secure portal
              </span>
              <h2 className="mt-16 text-2xl font-semibold tracking-[-0.04em]">{portal.title}</h2>
              <p className="mt-3 text-sm leading-6 text-[#718075]">{portal.description}</p>
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
