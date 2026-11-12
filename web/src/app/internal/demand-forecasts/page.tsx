import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin", "production_manager", "inventory_manager", "sales_manager", "sales_director"] as const;

export default async function DemandForecastsPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM demand_forecasts ORDER BY period DESC");

  return (
    <PortalShell description="Demand forecasting per product per period." eyebrow="Planning" highlights={["Forecast demand."]} profile={profile} title="Demand forecasts">
      <DataPanel title="Forecast register">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Product</th><th className="pb-3 pr-4 font-bold">Period</th><th className="pb-3 pr-4 font-bold">Forecast</th><th className="pb-3 font-bold">Actual</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4">{r.product_id}</td>
                    <td className="py-3 pr-4">{r.period}</td>
                    <td className="py-3 pr-4">{r.forecast_qty}</td>
                    <td className="py-3">{r.actual_qty ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No forecasts yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Add forecast">
          <QuickCreateForm endpoint="/api/demand-forecasts" fields={[
            { name: "product_id", label: "Product ID", required: true },
            { name: "period", label: "Period (YYYY-MM)", required: true },
            { name: "forecast_qty", label: "Forecast qty", type: "number", required: true },
            { name: "actual_qty", label: "Actual qty", type: "number" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
