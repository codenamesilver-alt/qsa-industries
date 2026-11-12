import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin", "sales_rep", "sales_manager", "sales_director"] as const;

export default async function OpportunitiesPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM opportunities ORDER BY created_at DESC");

  return (
    <PortalShell description="Sales opportunities and pipeline." eyebrow="Sales / CRM" highlights={["Track opportunities."]} profile={profile} title="Opportunities">
      <DataPanel title="Opportunity pipeline">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Title</th><th className="pb-3 pr-4 font-bold">Stage</th><th className="pb-3 pr-4 font-bold">Value</th><th className="pb-3 pr-4 font-bold">Probability</th><th className="pb-3 font-bold">Expected close</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-semibold">{r.title}</td>
                    <td className="py-3 pr-4">{r.stage}</td>
                    <td className="py-3 pr-4">₹{r.value ?? 0}</td>
                    <td className="py-3 pr-4">{r.probability ?? "—"}%</td>
                    <td className="py-3">{r.expected_close ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No opportunities yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Add opportunity">
          <QuickCreateForm endpoint="/api/opportunities" fields={[
            { name: "title", label: "Title", required: true },
            { name: "lead_id", label: "Lead ID" },
            { name: "dealer_id", label: "Dealer ID" },
            { name: "stage", label: "Stage", options: ["prospecting", "qualification", "proposal", "negotiation", "won", "lost"] },
            { name: "value", label: "Value", type: "number" },
            { name: "probability", label: "Probability %", type: "number" },
            { name: "expected_close", label: "Expected close", type: "date" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
