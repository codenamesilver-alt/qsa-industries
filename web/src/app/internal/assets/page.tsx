import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";
import { formatNumber } from "../../../lib/format";

const roles = ["admin", "production_manager", "inventory_manager"] as const;

export default async function AssetsPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM assets ORDER BY code");

  return (
    <PortalShell description="Equipment and asset register with maintenance history." eyebrow="Internal operations / maintenance" highlights={["Track assets and maintenance logs."]} profile={profile} title="Assets & maintenance">
      <DataPanel title="Asset register">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Code</th><th className="pb-3 pr-4 font-bold">Name</th><th className="pb-3 pr-4 font-bold">Category</th><th className="pb-3 pr-4 font-bold">Location</th><th className="pb-3 pr-4 font-bold">Status</th><th className="pb-3 font-bold">Value</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-semibold">{r.code}</td>
                    <td className="py-3 pr-4">{r.name}</td>
                    <td className="py-3 pr-4">{r.category ?? "—"}</td>
                    <td className="py-3 pr-4">{r.location ?? "—"}</td>
                    <td className="py-3 pr-4">{r.status}</td>
                    <td className="py-3">₹{formatNumber(r.purchase_value ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No assets registered yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Add asset">
          <QuickCreateForm endpoint="/api/assets" fields={[
            { name: "code", label: "Code", required: true },
            { name: "name", label: "Name", required: true },
            { name: "category", label: "Category" },
            { name: "location", label: "Location" },
            { name: "purchase_value", label: "Value", type: "number" },
            { name: "status", label: "Status" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
