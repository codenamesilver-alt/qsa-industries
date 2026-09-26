import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { PortalShell } from "../../../components/portal-shell";
import { ProductionQcActions } from "../../../components/production-qc-actions";
import { ProductionRunForm } from "../../../components/production-run-form";
import { requireProfile } from "../../../lib/auth";
import { getProducts, getProductionRuns, getProductionSummary, getRawMaterials } from "../../../lib/data";
import { formatDate, formatNumber } from "../../../lib/format";

const roles = ["admin", "production_manager"] as const;

export default async function ProductionPage() {
  const profile = await requireProfile(roles);
  const [products, rawMaterials, summary, runs] = await Promise.all([
    getProducts(),
    getRawMaterials(),
    getProductionSummary(),
    getProductionRuns(),
  ]);
  const totalOutput = summary.reduce((sum, row) => sum + Number(row.total_output), 0);
  const totalRaw = summary.reduce((sum, row) => sum + Number(row.total_raw_material_input), 0);
  const averageYield = totalRaw ? totalOutput / totalRaw : 0;

  return (
    <PortalShell
      description="Log continuous feed production, quality status, and raw-material consumption against live stock."
      eyebrow="Internal operations / production"
      profile={profile}
      title="Make every batch count."
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard detail="Visible passed output groups" label="Output groups" value={String(summary.length).padStart(2, "0")} />
        <MetricCard detail="Finished goods produced" label="Total output" value={formatNumber(totalOutput)} />
        <MetricCard detail="Output divided by raw input" label="Average yield" value={averageYield ? averageYield.toFixed(3) : "—"} />
      </section>
      <div className="mt-6 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <DataPanel description="Saving a run consumes raw materials; passed QC also creates finished-goods stock-in." title="Record production run">
          <ProductionRunForm products={products} rawMaterials={rawMaterials} />
        </DataPanel>
        <DataPanel description="Output, raw-material input, and yield by run date and product." title="Yield report">
          {summary.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                  <tr>
                    <th className="pb-3 pr-4 font-bold">Date / product</th>
                    <th className="pb-3 pr-4 font-bold">Output</th>
                    <th className="pb-3 pr-4 font-bold">Raw input</th>
                    <th className="pb-3 font-bold">Yield</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8ede6]">
                  {summary.map((row) => (
                    <tr key={`${row.run_date}-${row.product_id}`}>
                      <td className="py-4 pr-4">
                        <p className="font-semibold">{row.product_name}</p>
                        <p className="mt-1 text-xs text-[#819083]">{formatDate(row.run_date)}</p>
                      </td>
                      <td className="py-4 pr-4 font-semibold">{formatNumber(row.total_output)}</td>
                      <td className="py-4 pr-4 text-[#5d6b60]">{formatNumber(row.total_raw_material_input)}</td>
                      <td className="py-4 font-semibold text-[#4e741d]">{row.yield_ratio ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="No production summary visible." />
          )}
        </DataPanel>
      </div>
      <div className="mt-6">
        <DataPanel description="Only admin or original run creator can update QC fields." title="Update QC status">
          <ProductionQcActions currentUserId={profile.id} role={profile.role} runs={runs} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
