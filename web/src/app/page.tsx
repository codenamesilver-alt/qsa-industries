import Link from "next/link";

// Static figures describing the seeded demo dataset. They cannot be read live
// because this is a public page and RLS denies anon reads, so they have to be
// kept in step with supabase/migrations/20260925092200_dev_demo_dataset.sql by
// hand. db:verify-fresh is what proves those numbers.
const metrics = [
  { label: "Dealers", value: "06", detail: "Mapped sales territories" },
  { label: "Products", value: "11", detail: "Poultry feed catalog" },
  { label: "Price lists", value: "12", detail: "Dealer pricing ready" },
  { label: "Team members", value: "13", detail: "Auth-linked profiles" },
];

const schemaTables = [
  {
    name: "users",
    description: "Role-bearing profiles linked to Supabase Auth.",
    relation: "auth.users → users",
  },
  {
    name: "user_hierarchy",
    description: "Sales director, manager, and representative reporting lines.",
    relation: "users.manager_id → users.id",
  },
  {
    name: "dealers",
    description: "Dealer identity, contact details, credit limits, and assignment.",
    relation: "dealers.sales_rep_id → users.id",
  },
  {
    name: "products",
    description: "Sellable poultry feed products with SKU and unit pricing.",
    relation: "products.id → price_lists.product_id",
  },
  {
    name: "price_lists",
    description: "Tier or dealer-specific selling prices with validity dates.",
    relation: "price_lists.dealer_id → dealers.id",
  },
];

const nextSteps = [
  "Apply remaining migrations to the remote project",
  "Run RLS and workflow tests against PostgreSQL",
  "Provision role accounts and validate every portal",
];

function QsaMark() {
  return (
    <svg
      aria-hidden="true"
      className="h-10 w-10"
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="40" height="40" rx="12" fill="#D8F35B" />
      <path
        d="M11 12.5C11 11.672 11.672 11 12.5 11H27.5C28.328 11 29 11.672 29 12.5V27.5C29 28.328 28.328 29 27.5 29H12.5C11.672 29 11 28.328 11 27.5V12.5Z"
        stroke="#15221B"
        strokeWidth="2"
      />
      <path
        d="M15 16.5H25M15 20H25M15 23.5H21"
        stroke="#15221B"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowUpRight() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 16 16" fill="none">
      <path d="M4 12L12 4M6 4H12V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Home() {
  const supabaseConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

  return (
    <main className="min-h-screen overflow-hidden bg-[#f5f7f2] text-[#15221b]">
      <div className="mx-auto max-w-7xl px-5 pb-12 sm:px-8 lg:px-10">
        <header className="flex items-center justify-between border-b border-[#dfe6dc] py-5">
          <div className="flex items-center gap-3">
            <QsaMark />
            <div>
              <p className="text-sm font-bold tracking-[0.18em]">QSA INDUSTRIES</p>
              <p className="text-xs text-[#6b786e]">Operations ERP</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              className="rounded-full border border-[#d6e1ce] bg-white px-4 py-2 text-xs font-bold text-[#4f6254] transition hover:border-[#9db56a] hover:text-[#15221b]"
              href="/login"
            >
              Portal sign in
            </Link>
            <div className="flex items-center gap-2 rounded-full border border-[#d6e1ce] bg-white px-3 py-1.5 text-xs font-semibold text-[#4f6254]">
              <span className="h-2 w-2 rounded-full bg-[#7bb51d]" />
               Stage 10 local build
            </div>
          </div>
        </header>

        <section className="grid gap-10 pb-14 pt-14 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:pt-20">
          <div>
            <p className="mb-5 text-xs font-bold uppercase tracking-[0.24em] text-[#6f8c3b]">
              Feed manufacturing control system
            </p>
            <h1 className="max-w-3xl text-5xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-7xl">
              Build the operating core.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-[#5d6b60]">
              QSA ERP connects production, inventory, sales, dealers, and finance through one
              role-aware data model.
            </p>
          </div>
          <div className="rounded-[2rem] bg-[#15221b] p-7 text-[#f5f7f2] shadow-[0_24px_70px_rgba(21,34,27,0.16)] sm:p-9">
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#b6d96b]">
                  Current milestone
                </p>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">Operations prototype</h2>
              </div>
              <span className="rounded-full bg-[#d8f35b] px-3 py-1 text-xs font-bold text-[#15221b]">
                Live
              </span>
            </div>
            <p className="mt-5 leading-7 text-[#c4d0c5]">
               Ten-stage ERP model is authored locally with inventory, production, orders, credit,
               dispatch, invoicing, reporting, and Tally export workflows.
            </p>
            <div className="mt-7 flex items-center gap-2 border-t border-white/15 pt-5 text-sm text-[#d5dfd5]">
              <span className="h-2 w-2 rounded-full bg-[#d8f35b]" />
              {supabaseConfigured ? "Supabase project connected" : "Supabase environment missing"}
            </div>
          </div>
        </section>

        <section aria-label="Seeded record counts" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-3xl border border-[#dfe6dc] bg-white p-6">
              <p className="text-sm font-medium text-[#718075]">{metric.label}</p>
              <p className="mt-5 text-5xl font-semibold tracking-[-0.06em]">{metric.value}</p>
              <p className="mt-3 text-sm text-[#718075]">{metric.detail}</p>
            </div>
          ))}
        </section>

        <section className="mt-16 grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-[2rem] border border-[#dfe6dc] bg-white p-6 sm:p-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6f8c3b]">Data model</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em]">Foundation tables</h2>
              </div>
              <p className="max-w-xs text-right text-sm leading-6 text-[#718075]">
                Clean ownership starts with explicit records and database-level relationships.
              </p>
            </div>
            <div className="mt-8 divide-y divide-[#e8ede6]">
              {schemaTables.map((table) => (
                <div key={table.name} className="grid gap-3 py-5 first:pt-0 sm:grid-cols-[1fr_1.4fr_1fr] sm:items-center sm:gap-5">
                  <p className="font-mono text-sm font-semibold text-[#15221b]">{table.name}</p>
                  <p className="text-sm leading-6 text-[#667469]">{table.description}</p>
                  <p className="font-mono text-xs text-[#819083]">{table.relation}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] bg-[#e5efd9] p-6 sm:p-8">
             <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6f8c3b]">Next build stage</p>
             <h2 className="mt-3 text-3xl font-semibold tracking-[-0.045em]">Operational control.</h2>
             <p className="mt-5 leading-7 text-[#5d6b60]">
               Role-aware workflows now connect production, stock, sales, credit, dispatch, finance,
               reporting, and exports through one operational model.
             </p>
            <ul className="mt-7 space-y-4">
              {nextSteps.map((step, index) => (
                <li key={step} className="flex gap-3 text-sm font-medium text-[#334536]">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#15221b] text-xs font-bold text-[#d8f35b]">
                    {index + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex items-center gap-2 border-t border-[#cbdab9] pt-5 text-sm font-semibold text-[#4c624d]">
              <span className="h-2 w-2 rounded-full bg-[#7bb51d]" />
                Stage 10 of 10 live · 18 migrations applied · 5 pgTAP suites green
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-6 md:grid-cols-3">
          {[
            ["Internal operations", "Production, inventory, dispatch, and finance controls."],
            ["Sales management", "Rep coverage, approvals, credit exposure, and director escalation."],
            ["Dealer portal", "Live catalog, dealer pricing, orders, and account visibility."],
          ].map(([title, description], index) => (
            <div key={title} className="group rounded-3xl border border-[#dfe6dc] bg-[#15221b] p-6 text-white transition-transform hover:-translate-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold tracking-[0.2em] text-[#b6d96b]">0{index + 1}</span>
                <ArrowUpRight />
              </div>
              <h3 className="mt-12 text-xl font-semibold">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-[#bdcbbb]">{description}</p>
            </div>
          ))}
        </section>

        <footer className="mt-12 flex flex-col gap-2 border-t border-[#dfe6dc] pt-6 text-xs text-[#718075] sm:flex-row sm:items-center sm:justify-between">
          <span>QSA Industries · Feed manufacturing ERP</span>
          <span>Supabase · Next.js · Role-aware architecture</span>
        </footer>
      </div>
    </main>
  );
}
