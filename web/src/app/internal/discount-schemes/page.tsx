import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin", "finance", "sales_manager", "sales_director"] as const;

export default async function DiscountSchemesPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM discount_schemes ORDER BY created_at DESC");

  return (
    <PortalShell description="Discount schemes and promotions." eyebrow="Sales / commercial" highlights={["Manage discount schemes."]} profile={profile} title="Discount schemes">
      <DataPanel title="Scheme register">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Name</th><th className="pb-3 pr-4 font-bold">Type</th><th className="pb-3 pr-4 font-bold">Value</th><th className="pb-3 pr-4 font-bold">Min qty</th><th className="pb-3 font-bold">Active</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-semibold">{r.name}</td>
                    <td className="py-3 pr-4">{r.discount_type}</td>
                    <td className="py-3 pr-4">{r.discount_value}</td>
                    <td className="py-3 pr-4">{r.min_qty ?? "—"}</td>
                    <td className="py-3">{r.is_active ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No schemes yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Create scheme">
          <QuickCreateForm endpoint="/api/discount-schemes" fields={[
            { name: "name", label: "Name", required: true },
            { name: "description", label: "Description" },
            { name: "discount_type", label: "Type", options: ["percent", "fixed", "buy_x_get_y"] },
            { name: "discount_value", label: "Value", type: "number", required: true },
            { name: "min_qty", label: "Min qty", type: "number" },
            { name: "valid_from", label: "Valid from", type: "date" },
            { name: "valid_to", label: "Valid to", type: "date" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
