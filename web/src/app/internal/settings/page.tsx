import Link from "next/link";
import { FinanceSettingsForm } from "../../../components/finance-settings-form";
import { ModuleSelector } from "../../../components/module-selector";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { getFinanceSettings } from "../../../lib/data";

const roles = ["admin"] as const;

export default async function SettingsPage() {
  const profile = await requireProfile(roles);
  const settings = await getFinanceSettings();

  return (
    <PortalShell
      description="Configure ageing thresholds, credit rules, export data, and manage portal access and master data."
      eyebrow="Internal operations / settings"
      highlights={[
        "Ageing grace period and bucket thresholds",
        "Credit exposure rules",
        "Tally CSV export",
        "User and role management",
        "Dealer onboarding",
        "Product and price catalogue",
      ]}
      profile={profile}
      title="Settings and administration."
    >
      <section className="grid gap-6 lg:grid-cols-2 auto-rows-fr">
        <div className="rounded-[2rem] border border-[#dfe6dc] bg-white p-6 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6f8c3b]">QSA control panel</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">Ageing and credit settings</h2>
          <p className="mt-2 text-sm text-[#718075]">Buckets are driven by the grace period and thresholds set here.</p>
          <div className="mt-7">
            <FinanceSettingsForm settings={settings} />
          </div>
        </div>

        <div className="rounded-[2rem] border border-[#dfe6dc] bg-white p-6 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6f8c3b]">QSA control panel</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">Tally export</h2>
          <p className="mt-2 text-sm text-[#718075]">Download the Tally CSV for a date range.</p>
          <div className="mt-7">
            <Link
              className="inline-flex rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-bold text-[#4f6254] hover:border-[#9db56a]"
              href="/api/tally/export"
            >
              Download Tally CSV (this month)
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <div className="rounded-[2rem] border border-[#dfe6dc] bg-white p-6 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6f8c3b]">QSA control panel</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">Portal management</h2>
          <p className="mt-2 text-sm text-[#718075]">Quick links to the management screens.</p>
          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Link className="rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-bold text-[#4f6254] hover:border-[#9db56a]" href="/internal/users">Users &amp; Roles</Link>
            <Link className="rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-bold text-[#4f6254] hover:border-[#9db56a]" href="/internal/admin">Administration</Link>
            <Link className="rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm font-bold text-[#4f6254] hover:border-[#9db56a]" href="/internal/admin">Products &amp; prices</Link>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <div className="rounded-[2rem] border border-[#dfe6dc] bg-white p-6 sm:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6f8c3b]">QSA control panel</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">Module selector</h2>
          <p className="mt-2 text-sm text-[#718075]">
            Choose a designation, then turn modules on or off for that designation and save.
          </p>
          <div className="mt-7">
            <ModuleSelector />
          </div>
        </div>
      </section>
    </PortalShell>
  );
}