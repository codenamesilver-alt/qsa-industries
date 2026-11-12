import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin", "sales_rep", "sales_manager", "sales_director"] as const;

export default async function VisitReportsPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM visit_reports ORDER BY visit_date DESC");

  return (
    <PortalShell description="Sales visit and call reports." eyebrow="Sales / field activity" highlights={["Log field visits."]} profile={profile} title="Visit reports">
      <DataPanel title="Visit log">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Date</th><th className="pb-3 pr-4 font-bold">Rep</th><th className="pb-3 pr-4 font-bold">Dealer</th><th className="pb-3 pr-4 font-bold">Purpose</th><th className="pb-3 font-bold">Outcome</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4">{r.visit_date}</td>
                    <td className="py-3 pr-4">{r.sales_rep_id}</td>
                    <td className="py-3 pr-4">{r.dealer_id ?? "—"}</td>
                    <td className="py-3 pr-4">{r.purpose ?? "—"}</td>
                    <td className="py-3">{r.outcome ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No visit reports yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Log a visit">
          <QuickCreateForm endpoint="/api/visit-reports" fields={[
            { name: "sales_rep_id", label: "Sales rep ID", required: true },
            { name: "dealer_id", label: "Dealer ID" },
            { name: "visit_date", label: "Visit date", type: "date", required: true },
            { name: "purpose", label: "Purpose" },
            { name: "outcome", label: "Outcome" },
            { name: "notes", label: "Notes" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
