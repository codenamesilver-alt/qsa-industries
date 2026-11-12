import { DataPanel, EmptyState } from "../../../components/data-panel";
import { EmployeeOnboardingForm } from "../../../components/employee-onboarding-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin", "production_manager", "inventory_manager", "finance"] as const;

export default async function EmployeesPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM employees ORDER BY full_name");

  return (
    <PortalShell description="Employee master with full onboarding details." eyebrow="Internal operations / HR" highlights={["Manage employees, attendance, leave and payroll."]} profile={profile} title="Employees & HR">
      <DataPanel title="Employee register">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Name</th><th className="pb-3 pr-4 font-bold">Department</th><th className="pb-3 pr-4 font-bold">Designation</th><th className="pb-3 pr-4 font-bold">Type</th><th className="pb-3 pr-4 font-bold">Aadhaar</th><th className="pb-3 pr-4 font-bold">PAN</th><th className="pb-3 pr-4 font-bold">Bank</th><th className="pb-3 font-bold">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-semibold">{r.full_name}</td>
                    <td className="py-3 pr-4">{r.department ?? "—"}</td>
                    <td className="py-3 pr-4">{r.designation ?? "—"}</td>
                    <td className="py-3 pr-4">{r.employment_type}</td>
                    <td className="py-3 pr-4">{r.aadhaar_number ?? "—"}</td>
                    <td className="py-3 pr-4">{r.pan_number ?? "—"}</td>
                    <td className="py-3 pr-4">{r.bank_account_number ?? "—"}</td>
                    <td className="py-3">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No employees registered yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Onboard employee">
          <EmployeeOnboardingForm />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
