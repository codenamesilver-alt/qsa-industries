import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { DeleteButton } from "../../../components/delete-button";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin"] as const;

export default async function DesignationsPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM designations ORDER BY sort_order, name");

  return (
    <PortalShell description="Job titles / designations catalogue." eyebrow="Internal operations / admin" highlights={["Manage designations."]} profile={profile} title="Designations">
      <DataPanel title="Designation catalogue">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Name</th><th className="pb-3 pr-4 font-bold">Description</th><th className="pb-3 pr-4 font-bold">Sort</th><th className="pb-3 font-bold">Active</th><th className="pb-3 font-bold">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-semibold">{r.name}</td>
                    <td className="py-3 pr-4">{r.description ?? "—"}</td>
                    <td className="py-3 pr-4">{r.sort_order}</td>
                    <td className="py-3 pr-4">{r.is_active ? "Yes" : "No"}</td>
                    <td className="py-3"><DeleteButton endpoint="/api/designations" id={r.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No designations yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Add designation">
          <QuickCreateForm endpoint="/api/designations" fields={[
            { name: "p_name", label: "Name", required: true },
            { name: "p_description", label: "Description" },
            { name: "p_sort_order", label: "Sort order", type: "number" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
