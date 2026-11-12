import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";
import { formatNumber } from "../../../lib/format";

const roles = ["admin", "finance"] as const;

export default async function PayrollPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM payroll_runs ORDER BY run_date DESC");

  return (
    <PortalShell description="Payroll runs and salary processing." eyebrow="Internal operations / HR" highlights={["Manage payroll."]} profile={profile} title="Payroll">
      <DataPanel title="Payroll runs">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Period</th><th className="pb-3 pr-4 font-bold">Run date</th><th className="pb-3 pr-4 font-bold">Total</th><th className="pb-3 font-bold">Status</th><th className="pb-3 font-bold">Slips</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-semibold">{r.period_name}</td>
                    <td className="py-3 pr-4">{r.run_date}</td>
                    <td className="py-3 pr-4">₹{formatNumber(r.total_amount)}</td>
                    <td className="py-3 pr-4">{r.status}</td>
                    <td className="py-3"><a className="text-xs font-bold text-[#6f8c3b] underline" href={`/internal/payslips?run_id=${r.id}`}>View / generate</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No payroll runs yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Create payroll run">
          <QuickCreateForm endpoint="/api/payroll-runs" fields={[
            { name: "period_name", label: "Period name", required: true },
            { name: "run_date", label: "Run date", type: "date", required: true },
            { name: "total_amount", label: "Total amount", type: "number" },
            { name: "status", label: "Status", options: ["draft", "processed", "paid"] },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
