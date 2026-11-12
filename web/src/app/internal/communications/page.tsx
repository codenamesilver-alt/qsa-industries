import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin", "sales_rep", "sales_manager", "sales_director", "finance"] as const;

export default async function CommunicationsPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM communications ORDER BY comm_date DESC");

  return (
    <PortalShell description="Dealer communication history." eyebrow="Sales / CRM" highlights={["Log calls, emails and visits to dealers."]} profile={profile} title="Communications">
      <DataPanel title="Communication log">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Date</th><th className="pb-3 pr-4 font-bold">Type</th><th className="pb-3 pr-4 font-bold">Dealer</th><th className="pb-3 pr-4 font-bold">Subject</th><th className="pb-3 font-bold">Notes</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 text-xs text-[#819083]">{r.comm_date}</td>
                    <td className="py-3 pr-4">{r.comm_type}</td>
                    <td className="py-3 pr-4">{r.dealer_id ?? "—"}</td>
                    <td className="py-3 pr-4">{r.subject ?? "—"}</td>
                    <td className="py-3">{r.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No communications logged yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Log communication">
          <QuickCreateForm endpoint="/api/communications" fields={[
            { name: "dealer_id", label: "Dealer ID" },
            { name: "comm_type", label: "Type", required: true, options: ["call", "email", "visit", "whatsapp", "other"] },
            { name: "subject", label: "Subject" },
            { name: "notes", label: "Notes" },
            { name: "comm_date", label: "Date", type: "datetime-local" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
