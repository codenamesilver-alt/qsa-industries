import { BatchReceiveForm } from "../../../components/batch-receive-form";
import { MetricCard } from "../../../components/data-panel";
import { BatchQueue, MovementHistory, StockLedger } from "../../../components/inventory-lists";
import { PortalShell } from "../../../components/portal-shell";
import { CollapsiblePanel, PanelStack } from "../../../components/panel-stack";
import { StockAdjustmentForm } from "../../../components/stock-adjustment-form";
import { requireProfile } from "../../../lib/auth";
import { getExpiringBatches, getInventoryDashboard, getProducts, getStockMovements } from "../../../lib/data";
import { formatDate } from "../../../lib/format";

// receive_into_batch allows admin, inventory_manager and production_manager, which
// is the same set as this page, so the batch form is always available here.
const roles = ["admin", "production_manager", "inventory_manager"] as const;


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
  const soonest = batches[0];

  return (
    <PortalShell
      description="Track finished goods and raw materials, receive traceable batches against expiry dates, and inspect every movement."
      eyebrow="Internal operations / inventory"
      highlights={[
        "Stock ledger: quantity on hand against the low-stock threshold for every product",
        "Record a stock-in or stock-out adjustment with a mandatory reason",
        "Receive stock into a traceable batch with batch code, manufacture date and expiry date",
        "Batch and expiry queue in the order dispatch will draw from, soonest expiry first",
        "Movement history: the latest 100 stock movements with their source and reason",
      ]}
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
      <div className="mt-6 space-y-6">
        <PanelStack defaultOpenId="ledger">
          <CollapsiblePanel
            description="Current quantity, threshold, and replenishment state. Search by product, SKU or category to find one position without scrolling past every other product."
            id="ledger"
            summary={`${inventory.length} products`}
            title="Stock ledger"
          >
            <StockLedger rows={inventory} />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Open batches in the order dispatch will draw them, soonest expiry first. Expired stock is still shown so it can be written off deliberately."
            id="batches"
            summary={`${batches.length} open`}
            title="Batch and expiry queue"
          >
            <BatchQueue rows={batches} />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Every adjustment is written to stock movements and updates stock levels automatically."
            id="adjust"
            title="Record adjustment"
          >
            <StockAdjustmentForm products={products} />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Receiving into a batch makes the stock traceable and puts it in the dispatch queue."
            id="receive"
            title="Receive into batch"
          >
            <BatchReceiveForm products={products} />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Newest movement records visible in your role scope."
            id="movements"
            summary={`${movements.length} movements`}
            title="Movement history"
          >
            <MovementHistory rows={movements} />
          </CollapsiblePanel>
        </PanelStack>
      </div>
    </PortalShell>
  );
}
