import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin", "inventory_manager", "production_manager"] as const;

export default async function ReorderRulesPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM reorder_rules ORDER BY created_at DESC");
  const products = await query<any>("SELECT id, name, sku FROM products WHERE active=1");

  return (
    <PortalShell description="Auto-reorder rules for low stock." eyebrow="Internal operations / inventory" highlights={["Configure reorder rules."]} profile={profile} title="Reorder rules">
      <DataPanel title="Rules">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Product</th><th className="pb-3 pr-4 font-bold">Min qty</th><th className="pb-3 pr-4 font-bold">Reorder qty</th><th className="pb-3 pr-4 font-bold">Supplier</th><th className="pb-3 font-bold">Active</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4">{r.product_id}</td>
                    <td className="py-3 pr-4">{r.min_qty}</td>
                    <td className="py-3 pr-4">{r.reorder_qty}</td>
                    <td className="py-3 pr-4">{r.preferred_supplier ?? "—"}</td>
                    <td className="py-3">{r.is_active ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No reorder rules yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Add reorder rule">
          <QuickCreateForm endpoint="/api/reorder-rules" fields={[
            { name: "product_id", label: "Product ID", required: true },
            { name: "min_qty", label: "Min qty", type: "number", required: true },
            { name: "reorder_qty", label: "Reorder qty", type: "number", required: true },
            { name: "preferred_supplier", label: "Preferred supplier" },
            { name: "is_active", label: "Active (1/0)" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
