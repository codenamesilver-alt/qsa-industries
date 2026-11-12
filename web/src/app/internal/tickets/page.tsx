import { DataPanel, EmptyState } from "../../../components/data-panel";
import { TicketActions } from "../../../components/ticket-actions";
import { TicketCreateForm } from "../../../components/ticket-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin", "finance", "sales_manager", "sales_director", "logistics", "production_manager", "inventory_manager", "qc_staff"] as const;

export default async function TicketsPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM tickets ORDER BY created_at DESC");
  const users = await query<any>("SELECT id, full_name, role FROM users WHERE is_active=1");

  return (
    <PortalShell description="Complaints, service requests and tickets with approval workflow." eyebrow="Internal operations / support" highlights={["Tickets route to the reporting manager for approval, then land in the designated department."]} profile={profile} title="Tickets & complaints">
      <DataPanel title="Ticket register">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Number</th><th className="pb-3 pr-4 font-bold">Subject</th><th className="pb-3 pr-4 font-bold">Department</th><th className="pb-3 pr-4 font-bold">Approver</th><th className="pb-3 pr-4 font-bold">Priority</th><th className="pb-3 pr-4 font-bold">Status</th><th className="pb-3 font-bold">Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-semibold">{r.ticket_number}</td>
                    <td className="py-3 pr-4">{r.subject}</td>
                    <td className="py-3 pr-4">{r.department ?? "—"}</td>
                    <td className="py-3 pr-4">{r.approver_id ?? "—"}</td>
                    <td className="py-3 pr-4">{r.priority}</td>
                    <td className="py-3 pr-4">{r.status}</td>
                    <td className="py-3">
                      <TicketActions id={r.id} status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No tickets yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Raise a ticket">
          <TicketCreateForm users={users} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
