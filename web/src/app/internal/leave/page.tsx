import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin", "production_manager", "inventory_manager", "finance"] as const;

export default async function LeavePage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM leave_requests ORDER BY created_at DESC");

  return (
    <PortalShell description="Leave requests and approvals." eyebrow="Internal operations / HR" highlights={["Manage leave."]} profile={profile} title="Leave requests">
      <DataPanel title="Leave register">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Employee</th><th className="pb-3 pr-4 font-bold">Type</th><th className="pb-3 pr-4 font-bold">Start</th><th className="pb-3 pr-4 font-bold">End</th><th className="pb-3 font-bold">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4">{r.employee_id}</td>
                    <td className="py-3 pr-4">{r.leave_type}</td>
                    <td className="py-3 pr-4">{r.start_date}</td>
                    <td className="py-3 pr-4">{r.end_date}</td>
                    <td className="py-3">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No leave requests yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Apply for leave">
          <QuickCreateForm endpoint="/api/leave-requests" fields={[
            { name: "employee_id", label: "Employee ID", required: true },
            { name: "leave_type", label: "Leave type", required: true, options: ["casual", "sick", "earned", "unpaid"] },
            { name: "start_date", label: "Start date", type: "date", required: true },
            { name: "end_date", label: "End date", type: "date", required: true },
            { name: "reason", label: "Reason" },
            { name: "status", label: "Status", options: ["pending", "approved", "rejected"] },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
