import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { PortalShell } from "../../../components/portal-shell";
import { ProductionQcActions } from "../../../components/production-qc-actions";
import { requireProfile } from "../../../lib/auth";
import { getProductionRuns, getRawMaterials } from "../../../lib/data";
import { formatDate, formatNumber } from "../../../lib/format";

// The QC verdict queue. production_runs_update_internal lets admin and qc_staff
// update any run and a production_manager only their own, and the SELECT policy
// includes qc_staff, so this page is the first place the qc_staff role has ever
// had a route to land on.
const roles = ["admin", "qc_staff", "production_manager"] as const;

const qcTone = (status: string) => {
  if (status === "passed") return "border-[#b9d98a] bg-[#eff8df] text-[#4e741d]";
  if (status === "failed") return "border-[#f2b8ad] bg-[#fff0ed] text-[#a33a2b]";
  return "border-[#f0cf86] bg-[#fff7df] text-[#8b6412]";
};

export default async function QualityPage() {
  const profile = await requireProfile(roles);
  const [runs, rawMaterials] = await Promise.all([getProductionRuns(), getRawMaterials()]);
  const pending = runs.filter((run) => run.qc_status === "pending");
  const passed = runs.filter((run) => run.qc_status === "passed");
  const failed = runs.filter((run) => run.qc_status === "failed");
  const decided = runs.filter((run) => run.qc_status !== "pending");
  const passRate = decided.length ? Math.round((passed.length / decided.length) * 100) : null;

  return (
    <PortalShell
      description="Clear the quality queue. A passed verdict is what releases finished goods into sellable stock, and it is final once recorded."
      eyebrow="Internal operations / quality"
      profile={profile}
      title="Clear the quality queue."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard detail="Runs with no verdict yet" label="Pending" value={String(pending.length).padStart(2, "0")} />
        <MetricCard detail="Released to sellable stock" label="Passed" value={String(passed.length).padStart(2, "0")} />
        <MetricCard detail="Held back, notes required" label="Failed" value={String(failed.length).padStart(2, "0")} />
        <MetricCard
          detail="Of runs that carry a verdict"
          label="Pass rate"
          value={passRate === null ? "—" : `${passRate}%`}
        />
      </section>

      <div className="mt-6">
        <DataPanel
          description="Pick a run and record its verdict. A failed verdict requires notes, and a decided run cannot be reopened."
          title="Record QC verdict"
        >
          <ProductionQcActions currentUserId={profile.id} role={profile.role} runs={runs} />
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel description="Every run visible to your role, newest first." title="Quality queue">
          {runs.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                  <tr>
                    <th className="pb-3 pr-4 font-bold">Run</th>
                    <th className="pb-3 pr-4 font-bold">Output</th>
                    <th className="pb-3 pr-4 font-bold">Verdict</th>
                    <th className="pb-3 font-bold">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8ede6]">
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td className="py-4 pr-4">
                        <p className="font-semibold">{run.products?.name ?? "Product"}</p>
                        <p className="mt-1 text-xs text-[#819083]">
                          {run.products?.sku ?? run.product_id} · {formatDate(run.run_date)} · {run.shift}
                        </p>
                      </td>
                      <td className="py-4 pr-4 font-semibold">{formatNumber(run.quantity_produced)}</td>
                      <td className="py-4 pr-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${qcTone(run.qc_status)}`}>
                          {run.qc_status}
                        </span>
                      </td>
                      <td className="py-4 text-[#5d6b60]">{run.qc_notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="No production runs are visible to your role." />
          )}
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel
          description="Raw materials are readable by quality so a verdict can be taken against what was actually consumed."
          title="Materials in scope"
        >
          {rawMaterials.length ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {rawMaterials.map((material) => (
                <div className="rounded-2xl border border-[#e8ede6] p-3" key={material.id}>
                  <p className="font-semibold">{material.name}</p>
                  <p className="mt-1 text-xs text-[#819083]">
                    {material.products?.[0]?.sku ?? "—"} · per {material.unit}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No raw materials are visible to your role." />
          )}
        </DataPanel>
      </div>
    </PortalShell>
  );
}
