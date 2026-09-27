import { BatchReceiveForm } from "../../../components/batch-receive-form";
import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { PortalShell } from "../../../components/portal-shell";
import { StockAdjustmentForm } from "../../../components/stock-adjustment-form";
import { requireProfile } from "../../../lib/auth";
import { getExpiringBatches, getInventoryDashboard, getProducts, getStockMovements } from "../../../lib/data";
import { formatDate, formatNumber } from "../../../lib/format";

// receive_into_batch allows admin, inventory_manager and production_manager, which
// is the same set as this page, so the batch form is always available here.
const roles = ["admin", "production_manager", "inventory_manager"] as const;

const expiryTone = (status: string) => {
  if (status === "expired") return "border-[#f2b8ad] bg-[#fff0ed] text-[#a33a2b]";
  if (status === "critical") return "border-[#f0cf86] bg-[#fff7df] text-[#8b6412]";
  if (status === "warning") return "border-[#a9d3db] bg-[#e8f7f8] text-[#276c76]";
  return "border-[#b9d98a] bg-[#eff8df] text-[#4e741d]";
};

export default async function InventoryPage() {
  const profile = await requireProfile(roles);
  const [inventory, products, movements, batches] = await Promise.all([
    getInventoryDashboard(),
    getProducts(),
    getStockMovements(),
    getExpiringBatches(),
  ]);
  const lowStock = inventory.filter((row) => row.low_stock);
  // FEFO is enforced inside dispatch_order, so the useful thing this screen can
  // show is the queue that dispatch will actually draw from, soonest expiry
  // first. Sorting here mirrors the order the view already returns.
  const atRisk = batches.filter((batch) => batch.expiry_status === "expired" || batch.expiry_status === "critical");
  const soonest = batches[0];

  return (
    <PortalShell
      description="Track finished goods and raw materials, receive traceable batches against expiry dates, and inspect every movement."
      eyebrow="Internal operations / inventory"
      profile={profile}
      title="Know every unit."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard detail="Visible stock positions" label="Products" value={String(inventory.length).padStart(2, "0")} />
        <MetricCard detail="At or below threshold" label="Low stock" value={String(lowStock.length).padStart(2, "0")} />
        <MetricCard detail="Open batches with stock left" label="Live batches" value={String(batches.length).padStart(2, "0")} />
        <MetricCard
          detail={soonest ? `${soonest.batch_code} · ${formatDate(soonest.expiry_date)}` : "No open batches"}
          label="Soonest expiry"
          value={soonest ? String(soonest.days_remaining) : "—"}
        />
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
        <DataPanel
          description="Receiving into a batch makes the stock traceable and puts it in the dispatch queue."
          title="Receive into batch"
        >
          <BatchReceiveForm products={products} />
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel
          description="Open batches in the order dispatch will draw them, soonest expiry first. Expired stock is still shown so it can be written off deliberately."
          title="Batch and expiry queue"
        >
          {batches.length ? (
            <>
              {atRisk.length ? (
                <p className="mb-4 rounded-2xl bg-[#fff7df] px-4 py-3 text-sm text-[#8b6412]">
                  {atRisk.length} batch{atRisk.length === 1 ? "" : "es"} need attention: already expired, or within 30
                  days. Dispatch will not draw on an expired batch.
                </p>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                    <tr>
                      <th className="pb-3 pr-4 font-bold">Batch</th>
                      <th className="pb-3 pr-4 font-bold">Product</th>
                      <th className="pb-3 pr-4 font-bold">Available</th>
                      <th className="pb-3 pr-4 font-bold">Expiry</th>
                      <th className="pb-3 font-bold">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e8ede6]">
                    {batches.map((batch) => (
                      <tr key={batch.batch_id}>
                        <td className="py-4 pr-4">
                          <p className="font-semibold">{batch.batch_code}</p>
                          <p className="mt-1 text-xs text-[#819083]">
                            Made {formatDate(batch.manufacture_date)}
                          </p>
                        </td>
                        <td className="py-4 pr-4">
                          <p className="font-semibold">{batch.product_name}</p>
                          <p className="mt-1 text-xs text-[#819083]">{batch.sku}</p>
                        </td>
                        <td className="py-4 pr-4 font-semibold">{formatNumber(batch.available_quantity)}</td>
                        <td className="py-4 pr-4 text-[#5d6b60]">
                          {formatDate(batch.expiry_date)}
                          <p className="mt-1 text-xs text-[#819083]">{formatNumber(batch.days_remaining)} days left</p>
                        </td>
                        <td className="py-4">
                          <span className={`rounded-full border px-3 py-1 text-xs font-bold ${expiryTone(batch.expiry_status)}`}>
                            {batch.expiry_status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <EmptyState message="No open batches. Receive stock into a batch to make it traceable." />
          )}
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
