import { Donut, FunnelBars, RankedBars, SplitBar, TrendChart, type TrendPoint } from "../../components/charts";
import { DataPanel, EmptyState, MetricCard } from "../../components/data-panel";
import { PortalShell } from "../../components/portal-shell";
import { requireProfile } from "../../lib/auth";
import {
  getCreditExposureSummary,
  getOrders,
  getSalesDailySplit,
  getStageFunnel,
  getStatusSummary,
} from "../../lib/data";
import { formatDate, formatNumber, statusLabel, statusTone } from "../../lib/format";

const salesRoles = ["sales_rep", "sales_manager", "sales_director"] as const;

// Fixed palette, one colour per lifecycle stage. Derived from the same token family
// as the internal dashboard's donut so a stage looks the same on both portals.
// Keys are exactly the order_status enum values. Transport progress is a separate
// lifecycle tracked on delivery_status, not a stage an order passes through here, so
// in_transit and delivered are deliberately absent.
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

export default async function SalesPortalPage() {
  const profile = await requireProfile(salesRoles);
  const [orders, statuses, exposure, daily, funnel] = await Promise.all([
    getOrders(),
    getStatusSummary(),
    getCreditExposureSummary(),
    getSalesDailySplit(),
    getStageFunnel(),
  ]);

  const pending = orders.filter((order) => order.status === "pending");
  const escalated = orders.filter((order) => order.status === "pending_director_approval");
  const totalExposure = exposure.reduce((sum, row) => sum + Number(row.exposure), 0);
  const totalOutstanding = exposure.reduce((sum, row) => sum + Number(row.outstanding_amount), 0);

  // The daily view omits days with no orders, so the chart is backfilled across the
  // full range. Without this a quiet Tuesday collapses the axis and two days either
  // side of it render adjacent, which reads as a continuous trend that never happened.
  const dates = [...new Set(daily.map((row) => row.order_date))].sort();
  const trend: TrendPoint[] = [];
  if (dates.length > 0) {
    const cursor = new Date(`${dates[0]}T00:00:00Z`);
    const last = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
    while (cursor <= last) {
      const key = cursor.toISOString().slice(0, 10);
      const rows = daily.filter((row) => row.order_date === key);
      trend.push({
        label: dayLabel(key),
        realized: rows.reduce((sum, row) => sum + Number(row.realized_amount), 0),
        pipeline: rows.reduce((sum, row) => sum + Number(row.pipeline_amount), 0),
        rejected: rows.reduce((sum, row) => sum + Number(row.rejected_amount), 0),
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const realizedTotal = daily.reduce((sum, row) => sum + Number(row.realized_amount), 0);
  const pipelineTotal = daily.reduce((sum, row) => sum + Number(row.pipeline_amount), 0);
  const demandTotal = realizedTotal + pipelineTotal;
  const conversion = demandTotal > 0 ? (realizedTotal / demandTotal) * 100 : 0;

  return (
    <PortalShell
      description="A role-aware sales workspace for territory coverage, dealer accounts, approvals, and commercial flow."
      eyebrow="Sales management portal"
      highlights={[
        "Sales trend: realized revenue against pipeline value, by period",
        "Realized against uncommitted demand, so coverage gaps are visible",
        "Pipeline health by stage and order counts by status",
        "Credit watch and open exposure, ranked by dealer",
        "Orders by lifecycle stage and the most recent activity",
      ]}
      profile={profile}
      title="Move every account."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard detail="Awaiting review" label="Pending orders" value={String(pending.length).padStart(2, "0")} />
        <MetricCard detail="Needs director decision" label="Escalations" value={String(escalated.length).padStart(2, "0")} />
        <MetricCard detail="Visible dealer order value" label="Open exposure" value={`₹${formatNumber(totalExposure)}`} />
        <MetricCard
          detail={demandTotal > 0 ? `${Math.round(conversion)}% of demand realized` : "Across visible accounts"}
          label="Orders tracked"
          value={String(orders.length).padStart(2, "0")}
        />
      </section>

      <div className="mt-6">
        <DataPanel
          description="Realized and pipeline are separate series on purpose. Adding them gives a number that is neither revenue nor risk."
          title="Sales trend"
        >
          <TrendChart
            description="Calendar days in Asia/Kolkata, matching every other reporting view. Days with no orders are shown as zero so the axis stays honest."
            points={trend}
            title="Realized against uncommitted demand"
          />
        </DataPanel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <DataPanel description="Status mix is scoped by role and reporting hierarchy." title="Pipeline health">
          {statuses.length ? (
            <>
              <Donut
                centreLabel={String(statuses.reduce((sum, row) => sum + Number(row.order_count), 0))}
                description="Share of orders by count. Slices under 4% are grouped as Other."
                slices={statuses.map((row) => ({
                  label: statusLabel(row.status),
                  value: Number(row.order_count),
                  colour: stageColour[row.status] ?? "#c9d3c4",
                }))}
                title="Order count by status"
              />
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {statuses.map((row) => (
                  <div className="rounded-2xl border border-[#e8ede6] p-4" key={row.status}>
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(row.status)}`}>
                      {statusLabel(row.status)}
                    </span>
                    <p className="mt-5 text-3xl font-semibold tracking-[-0.05em]">{formatNumber(row.order_count)}</p>
                    <p className="mt-1 text-xs text-[#819083]">₹{formatNumber(row.total_amount)} total value</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <EmptyState message="No order activity visible in your scope." />
          )}
        </DataPanel>

        <DataPanel
          description="Exposure is pending plus approved value. Outstanding is the unpaid balance on raised invoices, and is deliberately not netted against it."
          title="Credit watch"
        >
          {exposure.length ? (
            <div className="space-y-5">
              <RankedBars
                description="Ranked on exposure. Green is committed demand at risk."
                emptyMessage="No dealer exposure visible in your scope."
                rows={exposure.map((row) => ({
                  label: row.dealer_name,
                  value: Number(row.exposure),
                  detail: `Limit ₹${formatNumber(row.credit_limit)} · ₹${formatNumber(row.outstanding_amount)} outstanding across ${row.open_invoices} open invoices`,
                }))}
                title="Open exposure by dealer"
                valueLabel="All time"
              />
              <div className="border-t border-[#e8ede6] pt-4">
                <p className="text-sm font-semibold">Committed against uncommitted</p>
                <p className="mt-1 text-xs text-[#718075]">
                  Realized ₹{formatNumber(realizedTotal)} · pipeline ₹{formatNumber(pipelineTotal)}
                </p>
                <div className="mt-3">
                  <SplitBar label="Your visible book" pipeline={pipelineTotal} realized={realizedTotal} />
                </div>
                <p className="mt-3 text-xs text-[#819083]">
                  Total outstanding across visible accounts: ₹{formatNumber(totalOutstanding)}
                </p>
              </div>
            </div>
          ) : (
            <EmptyState message="No dealer exposure visible in your scope." />
          )}
        </DataPanel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <DataPanel
          description="Where orders are sitting. A stage wider than the one before it is where approvals are piling up."
          title="Order stages"
        >
          <FunnelBars
            description="Ordered along the lifecycle rather than alphabetically."
            rows={funnel.map((row) => ({
              label: statusLabel(row.status),
              count: Number(row.order_count),
              amount: Number(row.total_amount),
            }))}
            title="Orders by lifecycle stage"
          />
        </DataPanel>

        <DataPanel description="Newest visible orders. Use Sales orders for lifecycle actions." title="Recent activity">
          {orders.length ? (
            <div className="divide-y divide-[#e8ede6]">
              {orders.slice(0, 8).map((order) => (
                <div className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0" key={order.id}>
                  <div>
                    <p className="font-semibold">{order.dealer?.name ?? "Dealer"}</p>
                    <p className="mt-1 text-xs text-[#819083]">
                      {formatDate(order.created_at)} · {order.order_items?.length ?? 0} line items
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-semibold">₹{formatNumber(order.total_amount)}</span>
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(order.status)}`}>
                      {statusLabel(order.status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No recent orders visible." />
          )}
        </DataPanel>
      </div>
    </PortalShell>
  );
}
