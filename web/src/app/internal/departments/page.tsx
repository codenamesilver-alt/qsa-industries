import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { DeleteButton } from "../../../components/delete-button";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin"] as const;

export default async function DepartmentsPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM departments ORDER BY name");

  return (
    <PortalShell description="Department catalogue." eyebrow="Internal operations / admin" highlights={["Manage departments."]} profile={profile} title="Departments">
      <DataPanel title="Department list">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Name</th><th className="pb-3 pr-4 font-bold">Description</th><th className="pb-3 font-bold">Active</th><th className="pb-3 font-bold">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-semibold">{r.name}</td>
                    <td className="py-3 pr-4">{r.description ?? "—"}</td>
                    <td className="py-3 pr-4">{r.is_active ? "Yes" : "No"}</td>
                    <td className="py-3"><DeleteButton endpoint="/api/departments" id={r.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No departments yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Add department">
          <QuickCreateForm endpoint="/api/departments" fields={[
            { name: "name", label: "Name", required: true },
            { name: "description", label: "Description" },
            { name: "is_active", label: "Active (1/0)" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
