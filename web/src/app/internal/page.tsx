import { DataPanel, EmptyState, MetricCard } from "../../components/data-panel";
import { PortalShell } from "../../components/portal-shell";
import { requireProfile } from "../../lib/auth";
import { getInventoryDashboard, getOrders, getProductionSummary, getStatusSummary } from "../../lib/data";
import { formatDate, formatNumber, statusLabel, statusTone } from "../../lib/format";

const internalRoles = ["admin", "production_manager", "inventory_manager", "qc_staff", "logistics", "finance"] as const;

export default async function InternalPortalPage() {
  const profile = await requireProfile(internalRoles);
  const [inventory, production, statuses, orders] = await Promise.all([
    getInventoryDashboard(),
    getProductionSummary(),
    getStatusSummary(),
    getOrders(),
  ]);
  const lowStock = inventory.filter((row) => row.low_stock);
  const totalOutput = production.reduce((sum, row) => sum + Number(row.total_output), 0);
  const openOrders = orders.filter((order) => !["invoiced", "rejected"].includes(order.status));

  return (
    <PortalShell
      description="One protected workspace for production, inventory, logistics, finance, and administration controls."
      eyebrow="Internal operations portal"
      profile={profile}
      title="Run the business."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard detail={`${inventory.length} tracked products`} label="Stock positions" value={formatNumber(inventory.reduce((sum, row) => sum + Number(row.current_quantity), 0))} />
        <MetricCard detail="Needs replenishment" label="Low-stock alerts" value={String(lowStock.length).padStart(2, "0")} />
        <MetricCard detail="Across visible production runs" label="Output recorded" value={formatNumber(totalOutput)} />
        <MetricCard detail="Pending through dispatch" label="Open orders" value={String(openOrders.length).padStart(2, "0")} />
      </section>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {profile.role === "qc_staff" ? (
          <DataPanel description="Every run awaiting a quality verdict. Record a pass, hold, or fail on the Quality page." title="QC queue">
            {production.length ? (
              <div className="space-y-3">
                {production.slice(0, 6).map((row) => (
                  <div className="flex items-center justify-between gap-4 border-b border-[#e8ede6] pb-3 last:border-0 last:pb-0" key={`${row.run_date}-${row.product_id}`}>
                    <div>
                      <p className="font-semibold">{row.product_name}</p>
                      <p className="mt-1 text-xs text-[#819083]">{formatDate(row.run_date)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatNumber(row.total_output)} output</p>
                      <p className="mt-1 text-xs text-[#819083]">{row.yield_ratio ? `${row.yield_ratio} yield` : "Yield pending"}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No production runs visible in your scope." />
            )}
          </DataPanel>
        ) : (
          <DataPanel description="Visible production performance by day and product." title="Production pulse">
            {production.length ? (
              <div className="space-y-3">
                {production.slice(0, 6).map((row) => (
                  <div className="flex items-center justify-between gap-4 border-b border-[#e8ede6] pb-3 last:border-0 last:pb-0" key={`${row.run_date}-${row.product_id}`}>
                    <div>
                      <p className="font-semibold">{row.product_name}</p>
                      <p className="mt-1 text-xs text-[#819083]">{formatDate(row.run_date)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{formatNumber(row.total_output)} output</p>
                      <p className="mt-1 text-xs text-[#819083]">{row.yield_ratio ? `${row.yield_ratio} yield` : "Yield pending"}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No production runs visible in current role scope." />
            )}
          </DataPanel>
        )}
        {profile.role === "qc_staff" ? null : (
          <DataPanel description="Order movement across the full lifecycle." title="Order board">
            {statuses.length ? (
              <div className="space-y-3">
                {statuses.map((row) => (
                  <div className="flex items-center justify-between gap-4" key={row.status}>
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(row.status)}`}>{statusLabel(row.status)}</span>
                    <div className="text-right">
                      <p className="font-semibold">{formatNumber(row.order_count)} orders</p>
                      <p className="mt-1 text-xs text-[#819083]">₹{formatNumber(row.total_amount)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="No orders visible in current role scope." />
            )}
          </DataPanel>
        )}
      </div>
      {profile.role === "qc_staff" ? null : (
      <div className="mt-6">
        <DataPanel description="Low-stock positions update from stock levels after every movement." title="Inventory signals">
          {lowStock.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {lowStock.map((row) => (
                <div className="rounded-2xl border border-[#f0cf86] bg-[#fff7df] p-4" key={row.product_id}>
                  <p className="font-semibold text-[#6d5314]">{row.product_name}</p>
                  <p className="mt-2 text-sm text-[#8b6412]">{formatNumber(row.current_quantity)} {row.unit_of_measure} available</p>
                  <p className="mt-1 text-xs text-[#a27b25]">Threshold {formatNumber(row.low_stock_threshold)}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No low-stock alerts." />
          )}
        </DataPanel>
      </div>
      )}
    </PortalShell>
  );
}
