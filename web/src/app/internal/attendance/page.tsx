import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin", "production_manager", "inventory_manager", "finance"] as const;

export default async function AttendancePage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM attendance ORDER BY att_date DESC");

  return (
    <PortalShell description="Daily attendance register." eyebrow="Internal operations / HR" highlights={["Track attendance."]} profile={profile} title="Attendance">
      <DataPanel title="Attendance register">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Employee</th><th className="pb-3 pr-4 font-bold">Date</th><th className="pb-3 pr-4 font-bold">Status</th><th className="pb-3 pr-4 font-bold">Check in</th><th className="pb-3 font-bold">Check out</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4">{r.employee_id}</td>
                    <td className="py-3 pr-4">{r.att_date}</td>
                    <td className="py-3 pr-4">{r.status}</td>
                    <td className="py-3 pr-4">{r.check_in ?? "—"}</td>
                    <td className="py-3">{r.check_out ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No attendance records yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Mark attendance">
          <QuickCreateForm endpoint="/api/attendance" fields={[
            { name: "employee_id", label: "Employee ID", required: true },
            { name: "att_date", label: "Date", type: "date", required: true },
            { name: "status", label: "Status", options: ["present", "absent", "half_day", "leave", "holiday"] },
            { name: "check_in", label: "Check in (HH:MM:SS)" },
            { name: "check_out", label: "Check out (HH:MM:SS)" },
            { name: "notes", label: "Notes" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
