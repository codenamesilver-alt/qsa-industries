import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { PortalShell } from "../../../components/portal-shell";
import { StockAdjustmentForm } from "../../../components/stock-adjustment-form";
import { requireProfile } from "../../../lib/auth";
import { getInventoryDashboard, getProducts, getStockMovements } from "../../../lib/data";
import { formatDate, formatNumber } from "../../../lib/format";

const roles = ["admin", "production_manager", "inventory_manager"] as const;

export default async function InventoryPage() {
  const profile = await requireProfile(roles);
  const [inventory, products, movements] = await Promise.all([getInventoryDashboard(), getProducts(), getStockMovements()]);
  const lowStock = inventory.filter((row) => row.low_stock);

  return (
    <PortalShell
      description="Track finished goods and raw materials, record controlled adjustments, and inspect every movement."
      eyebrow="Internal operations / inventory"
      profile={profile}
      title="Know every unit."
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard detail="Visible stock positions" label="Products" value={String(inventory.length).padStart(2, "0")} />
        <MetricCard detail="At or below threshold" label="Low stock" value={String(lowStock.length).padStart(2, "0")} />
        <MetricCard detail="Latest movement records" label="Movement log" value={String(movements.length).padStart(2, "0")} />
      </section>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <DataPanel description="Current quantity, threshold, and replenishment state." title="Stock ledger">
          {inventory.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                  <tr>
                    <th className="pb-3 pr-4 font-bold">Product</th>
                    <th className="pb-3 pr-4 font-bold">Available</th>
                    <th className="pb-3 pr-4 font-bold">Threshold</th>
                    <th className="pb-3 font-bold">Signal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8ede6]">
                  {inventory.map((row) => (
                    <tr key={row.product_id}>
                      <td className="py-4 pr-4">
                        <p className="font-semibold">{row.product_name}</p>
                        <p className="mt-1 text-xs text-[#819083]">{row.sku} · {row.category}</p>
                      </td>
                      <td className="py-4 pr-4 font-semibold">{formatNumber(row.current_quantity)} {row.unit_of_measure}</td>
                      <td className="py-4 pr-4 text-[#5d6b60]">{formatNumber(row.low_stock_threshold)}</td>
                      <td className="py-4">
                        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${row.low_stock ? "border-[#f0cf86] bg-[#fff7df] text-[#8b6412]" : "border-[#b9d98a] bg-[#eff8df] text-[#4e741d]"}`}>
                          {row.low_stock ? "Replenish" : "Healthy"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="No stock positions visible." />
          )}
        </DataPanel>
        <DataPanel description="Every adjustment is written to stock movements and updates stock levels automatically." title="Record adjustment">
          <StockAdjustmentForm products={products} />
        </DataPanel>
      </div>
      <div className="mt-6">
        <DataPanel description="Newest movement records visible in your role scope." title="Movement history">
          {movements.length ? (
            <div className="divide-y divide-[#e8ede6]">
              {movements.map((movement) => (
                <div className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0" key={movement.id}>
                  <div>
                    <p className="font-semibold">{movement.product?.name ?? "Product"}</p>
                    <p className="mt-1 text-xs text-[#819083]">{formatDate(movement.created_at)} · {movement.source}</p>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold ${movement.movement_type === "in" ? "text-[#4e741d]" : "text-[#a33a2b]"}`}>
                      {movement.movement_type === "in" ? "+" : "−"}{formatNumber(movement.quantity)}
                    </p>
                    {movement.reason ? <p className="mt-1 text-xs text-[#819083]">{movement.reason}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No stock movements visible." />
          )}
        </DataPanel>
      </div>
    </PortalShell>
  );
}
