import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin", "sales_rep", "sales_manager", "sales_director"] as const;

export default async function LeadsPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM leads ORDER BY created_at DESC");

  return (
    <PortalShell description="Leads and opportunities pipeline." eyebrow="Sales / CRM" highlights={["Track leads and opportunities."]} profile={profile} title="Leads & opportunities">
      <DataPanel title="Lead register">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Name</th><th className="pb-3 pr-4 font-bold">Company</th><th className="pb-3 pr-4 font-bold">Email</th><th className="pb-3 pr-4 font-bold">Source</th><th className="pb-3 font-bold">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-semibold">{r.name}</td>
                    <td className="py-3 pr-4">{r.company ?? "—"}</td>
                    <td className="py-3 pr-4">{r.email ?? "—"}</td>
                    <td className="py-3 pr-4">{r.source ?? "—"}</td>
                    <td className="py-3">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No leads yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Add lead">
          <QuickCreateForm endpoint="/api/leads" fields={[
            { name: "name", label: "Name", required: true },
            { name: "company", label: "Company" },
            { name: "email", label: "Email", type: "email" },
            { name: "phone", label: "Phone" },
            { name: "source", label: "Source" },
            { name: "status", label: "Status", options: ["new", "contacted", "qualified", "lost", "converted"] },
            { name: "notes", label: "Notes" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
