import { DataPanel, EmptyState } from "../../../components/data-panel";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";
import { formatNumber } from "../../../lib/format";
import { GenerateSlipsButton } from "../../../components/generate-slips-button";

const roles = ["admin", "finance"] as const;

export default async function PayslipsPage({ searchParams }: { searchParams: Promise<{ run_id?: string }> }) {
  const profile = await requireProfile(roles);
  const sp = await searchParams;
  const runId = sp.run_id;
  const sql = runId ? "SELECT * FROM payslips WHERE payroll_run_id=? ORDER BY employee_name" : "SELECT * FROM payslips ORDER BY generated_at DESC";
  const rows = await query<any>(sql, runId ? [runId] : []);
  const run = runId ? await query<any>("SELECT * FROM payroll_runs WHERE id=?", [runId]) : [];

  return (
    <PortalShell description="Salary slips generated from payroll runs." eyebrow="Internal operations / HR" highlights={["Generate and view salary slips."]} profile={profile} title="Salary slips">
      {runId && run.length ? (
        <p className="mb-4 text-sm text-[#5d6b60]">Period: <strong>{run[0].period_name}</strong> · Status: {run[0].status}</p>
      ) : null}
      <DataPanel title="Payslips">
        {rows.length ? (
          <div className="space-y-4">
            {rows.map((r: any) => (
              <div className="rounded-2xl border border-[#e8ede6] p-5" key={r.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{r.employee_name}</p>
                    <p className="mt-1 text-xs text-[#819083]">{r.period_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">Gross: ₹{formatNumber(r.gross)}</p>
                    <p className="text-sm text-[#819083]">Deductions: ₹{formatNumber(r.deductions)}</p>
                    <p className="text-sm font-bold text-[#4e741d]">Net: ₹{formatNumber(r.net)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : <EmptyState message="No payslips yet. Generate from a payroll run." />}
      </DataPanel>
      {runId ? <GenerateSlipsButton runId={runId} /> : null}
    </PortalShell>
  );
}
