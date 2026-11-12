import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin", "finance"] as const;

export default async function PeriodsPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM financial_periods ORDER BY start_date DESC");

  return (
    <PortalShell description="Financial periods and period closing." eyebrow="Internal operations / finance" highlights={["Manage financial periods."]} profile={profile} title="Financial periods">
      <DataPanel title="Period register">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Period</th><th className="pb-3 pr-4 font-bold">Start</th><th className="pb-3 pr-4 font-bold">End</th><th className="pb-3 font-bold">Closed</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-semibold">{r.period_name}</td>
                    <td className="py-3 pr-4">{r.start_date}</td>
                    <td className="py-3 pr-4">{r.end_date}</td>
                    <td className="py-3">{r.is_closed ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No periods yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Create period">
          <QuickCreateForm endpoint="/api/financial-periods" fields={[
            { name: "period_name", label: "Period name", required: true },
            { name: "start_date", label: "Start date", type: "date", required: true },
            { name: "end_date", label: "End date", type: "date", required: true },
            { name: "is_closed", label: "Closed (0/1)" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
