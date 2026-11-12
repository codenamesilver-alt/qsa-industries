import {
  Donut,
  FunnelBars,
  RankedBars,
  StockBars,
  TrendChart,
  YieldLine,
} from "../../components/charts";
import { DataPanel, EmptyState, MetricCard } from "../../components/data-panel";
import { PortalShell } from "../../components/portal-shell";
import { requireProfile } from "../../lib/auth";
import {
  getInventoryAging,
  getOrders,
  getProductionDaily,
  getProductionSummary,
  getProductionYieldByProduct,
  getStageFunnel,
  getStatusSummary,
} from "../../lib/data";
import { formatDate, formatNumber, statusLabel, statusTone } from "../../lib/format";

const internalRoles = ["admin", "production_manager", "inventory_manager", "qc_staff", "logistics", "finance"] as const;

const stageColour: Record<string, string> = {
  pending: "#e0a33e",
  pending_director_approval: "#c98a2b",
  approved: "#6f8c3b",
  dispatched: "#276c76",
  invoiced: "#8b6412",
  rejected: "#e08a76",
};

function dayLabel(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" }).format(
    new Date(value),
  );
}

export default async function InternalPortalPage() {
  const profile = await requireProfile(internalRoles);
  const [aging, production, dailyOutput, yieldByProduct, statuses, funnel, orders] = await Promise.all([
    getInventoryAging(),
    getProductionSummary(),
    getProductionDaily(),
    getProductionYieldByProduct(),
    getStatusSummary(),
    getStageFunnel(),
    getOrders(),
  ]);

  const lowStock = aging.filter((row) => Number(row.current_quantity) <= Number(row.low_stock_threshold));
  const deadStock = aging.filter((row) => row.dead_stock);
  const totalOutput = production.reduce((sum, row) => sum + Number(row.total_output), 0);
  const openOrders = orders.filter((order) => !["invoiced", "rejected"].includes(order.status));
  const stockValue = aging.reduce((sum, row) => sum + Number(row.current_quantity), 0);
  const totalOrderValue = orders.reduce((sum, row) => sum + Number(row.total_amount), 0);
  const deliveredOrders = orders.filter((order) => order.status === "invoiced" || order.status === "delivered" as any).length;

  const days = [...new Set(dailyOutput.map((row) => row.run_date))].sort();
  const yieldPoints = days.map((day) => {
    const rows = dailyOutput.filter((row) => row.run_date === day);
    const output = rows.reduce((sum, row) => sum + Number(row.total_output), 0);
    const input = rows.reduce((sum, row) => sum + Number(row.total_input), 0);
    return {
      label: dayLabel(day),
      realized: output,
      pipeline: input,
      rejected: 0,
      yieldRatio: input > 0 ? output / input : null,
    };
  });

  const statusSlices = statuses.map((row) => ({
    label: statusLabel(row.status),
    value: Number(row.order_count),
    colour: stageColour[row.status] ?? "#c9d3c4",
  }));

  return (
    <PortalShell
      description="One protected workspace for production, inventory, logistics, finance, and administration controls."
      eyebrow="Internal operations portal"
      highlights={[
        "Quality queue: production runs still waiting on a pass, hold or fail verdict",
        "Production output against raw material consumed, by day and by product",
        "Yield ratios per day and per product, worst-performing product ranked first",
        "Order counts by lifecycle stage, so you can see where approvals are piling up",
        "Stock levels against each product's reorder point",
        "Inventory signals: low stock, and stock held with no movement for 60 days",
        "Order board showing where every order currently sits in the lifecycle",
      ]}
      profile={profile}
      title="Run the business."
    >
      {/* Hero: the single most important at-a-glance number, with supporting stats. */}
      <section className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#baff48] via-[#eaf3d8] to-[#f2f3ed] p-6 shadow-[8px_8px_24px_#d9dcd5,-6px_-6px_18px_#ffffff] sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-end">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#4f6b2a]">Live operations</p>
            <h2 className="mt-2 text-5xl font-semibold leading-none tracking-[-0.04em] sm:text-6xl">
              {formatNumber(openOrders.length)}
            </h2>
            <p className="mt-2 text-lg font-medium text-[#27312d]">open orders in the pipeline</p>
            <p className="mt-1 max-w-md text-sm leading-6 text-[#5d6b60]">
              {formatNumber(totalOrderValue)} total order value across {orders.length} orders.{" "}
              {deliveredOrders} delivered to date.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/70 p-4 shadow-[inset_3px_3px_8px_#d9dcd5,inset_-3px_-3px_8px_#ffffff]">
              <p className="text-xs font-medium text-[#718075]">Output recorded</p>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{formatNumber(totalOutput)}</p>
              <p className="mt-1 text-xs text-[#819083]">units across runs</p>
            </div>
            <div className="rounded-2xl bg-white/70 p-4 shadow-[inset_3px_3px_8px_#d9dcd5,inset_-3px_-3px_8px_#ffffff]">
              <p className="text-xs font-medium text-[#718075]">Stock positions</p>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{formatNumber(stockValue)}</p>
              <p className="mt-1 text-xs text-[#819083]">{aging.length} tracked products</p>
            </div>
            <div className="rounded-2xl bg-white/70 p-4 shadow-[inset_3px_3px_8px_#d9dcd5,inset_-3px_-3px_8px_#ffffff]">
              <p className="text-xs font-medium text-[#718075]">Low-stock alerts</p>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{String(lowStock.length).padStart(2, "0")}</p>
              <p className="mt-1 text-xs text-[#819083]">{deadStock.length} not moved in 60d</p>
            </div>
            <div className="rounded-2xl bg-white/70 p-4 shadow-[inset_3px_3px_8px_#d9dcd5,inset_-3px_-3px_8px_#ffffff]">
              <p className="text-xs font-medium text-[#718075]">QC queue</p>
              <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
                {production.filter((r: any) => r.qc_status === "pending").length}
              </p>
              <p className="mt-1 text-xs text-[#819083]">runs awaiting verdict</p>
            </div>
          </div>
        </div>
      </section>

      {/* KPI strip */}
      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard detail={`${aging.length} tracked products`} label="Stock positions" value={formatNumber(stockValue)} />
        <MetricCard
          detail={deadStock.length ? `${deadStock.length} not moved in 60 days` : "Needs replenishment"}
          label="Low-stock alerts"
          value={String(lowStock.length).padStart(2, "0")}
        />
        <MetricCard detail="Across visible production runs" label="Output recorded" value={formatNumber(totalOutput)} />
        <MetricCard detail="Pending through dispatch" label="Open orders" value={String(openOrders.length).padStart(2, "0")} />
      </section>

      {/* Charts: production + order mix */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <DataPanel description="Output against raw material consumed, by day. Both are unit counts, not rupees." title="Production output and input">
          <TrendChart
            description="Passed runs only. A hold or a fail produced nothing, so counting it as output would flatter the line."
            kind="count"
            points={yieldPoints}
            title="Daily output against material consumed"
          />
        </DataPanel>

        <DataPanel description="How much of the order book sits at each stage. Waiting stages are amber, moving stages are teal." title="Order mix">
          <Donut
            centreLabel={String(statuses.reduce((sum, row) => sum + Number(row.order_count), 0))}
            description="Share of orders by count, across your role scope."
            slices={statusSlices}
            title="Order count by status"
          />
        </DataPanel>
      </div>

      {/* Order stages + stock levels */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <DataPanel description="Where every order in scope currently sits. A stage wider than the one before it is where work is piling up." title="Order stages">
          <FunnelBars
            description="Ordered along the lifecycle, not alphabetically, so a rejection does not appear mid-pipeline."
            rows={funnel.map((row) => ({
              label: statusLabel(row.status),
              count: Number(row.order_count),
              amount: Number(row.total_amount),
            }))}
            title="Orders by lifecycle stage"
          />
        </DataPanel>

        <DataPanel description="The tick on each bar is the reorder point. A product whose fill stops short of its tick needs replenishment." title="Stock against reorder point">
          <StockBars
            emptyMessage="No stock positions are visible in your scope."
            rows={aging.map((row) => ({
              label: row.product_name,
              quantity: Number(row.current_quantity),
              threshold: Number(row.low_stock_threshold),
              unit: row.unit_of_measure,
              daysSinceMovement: row.days_since_movement === null ? null : Number(row.days_since_movement),
            }))}
            title="Stock levels"
          />
        </DataPanel>
      </div>

      {/* Yield trend + yield by product */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <DataPanel description="Output per unit of raw material. The line is a ratio, not a quantity, which is why it is a line and not bars." title="Yield trend">
          <YieldLine
            description="A day with no recorded material input is left out rather than plotted as zero, because a zero would read as a total failure to produce."
            points={dailyOutput.map((row) => ({
              label: dayLabel(row.run_date),
              yieldRatio: row.yield_ratio === null ? null : Number(row.yield_ratio),
            }))}
            title="Daily yield"
          />
        </DataPanel>

        <DataPanel description="Ranked worst first. Summing a yield ratio across products is meaningless, so each bar is its own product." title="Yield by product">
          {yieldByProduct.length ? (
            <RankedBars
              emptyMessage="No passed production runs in scope."
              format="count"
              rows={yieldByProduct.map((row) => ({
                label: row.product_name,
                value: Number(row.total_output),
                secondary: row.yield_ratio === null ? undefined : Number(row.yield_ratio),
                detail:
                  row.yield_ratio === null
                    ? `No material input recorded · last run ${row.last_run_date ?? "never"}`
                    : `Yield ${Number(row.yield_ratio).toFixed(2)} per unit · ${row.run_count} runs`,
              }))}
              title="Output by product"
              valueLabel="All time"
            />
          ) : (
            <EmptyState message="No passed production runs in scope." />
          )}
        </DataPanel>
      </div>

      {/* Inventory signals + order board */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <DataPanel description="Low-stock positions update from stock levels after every movement. A product with stock but no movement for 60 days is listed too: it is not short, it is not selling." title="Inventory signals">
          {lowStock.length || deadStock.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {lowStock.map((row) => (
                <div className="rounded-2xl border border-[#f0cf86] bg-[#fff7df] p-4" key={row.product_id}>
                  <p className="font-semibold text-[#6d5314]">{row.product_name}</p>
                  <p className="mt-2 text-sm text-[#8b6412]">
                    {formatNumber(row.current_quantity)} {row.unit_of_measure} available
                  </p>
                  <p className="mt-1 text-xs text-[#a27b25]">Threshold {formatNumber(row.low_stock_threshold)}</p>
                </div>
              ))}
              {deadStock
                .filter((row) => !lowStock.some((low) => low.product_id === row.product_id))
                .map((row) => (
                  <div className="rounded-2xl border border-[#d6e1ce] bg-[#f5f7f2] p-4" key={row.product_id}>
                    <p className="font-semibold text-[#4f6254]">{row.product_name}</p>
                    <p className="mt-2 text-sm text-[#5d6b60]">
                      {formatNumber(row.current_quantity)} {row.unit_of_measure} unmoved
                    </p>
                    <p className="mt-1 text-xs text-[#819083]">
                      No movement for {formatNumber(row.days_since_movement)} days
                    </p>
                  </div>
                ))}
            </div>
          ) : (
            <EmptyState message="No low-stock or slow-moving alerts." />
          )}
        </DataPanel>

        <DataPanel description="Order movement across the full lifecycle." title="Order board">
          {statuses.length ? (
            <div className="space-y-3">
              {statuses.map((row) => (
                <div className="flex items-center justify-between gap-4" key={row.status}>
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(row.status)}`}>
                    {statusLabel(row.status)}
                  </span>
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
      </div>
    </PortalShell>
  );
}
