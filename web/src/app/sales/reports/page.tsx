import { RankedBars, SplitBar, TrendChart, type TrendPoint } from "../../../components/charts";
import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import {
  getSalesByDealer,
  getSalesByRegionPeriod,
  getSalesByRegionTotals,
  getSalesByRep,
} from "../../../lib/data";
import { formatNumber } from "../../../lib/format";

const reportRoles = ["sales_rep", "sales_manager", "sales_director", "admin", "finance"] as const;

// PRD 9.4: "Sales trends (by dealer, rep, manager, region/period)". Every figure on
// this screen comes from a view that is security_invoker, so each is already scoped
// to what the signed-in user may see: a rep sees their own accounts, a manager sees
// their reports', a director and finance see everything. That is enforced in the
// database, not here, so this page cannot leak by forgetting a filter -- and a
// forgotten filter on the client would have been the easy way to ship a data leak.
const roles = reportRoles;

function monthLabel(period: string) {
  const [year, month] = period.split("-");
  if (!year || !month) return period;
  return new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "Asia/Kolkata" }).format(
    new Date(Number(year), Number(month) - 1, 1),
  );
}

export default async function SalesReportingPage() {
  const profile = await requireProfile(roles);
  const [regionPeriod, regionTotals, byRep, byDealer] = await Promise.all([
    getSalesByRegionPeriod(),
    getSalesByRegionTotals(),
    getSalesByRep(),
    getSalesByDealer(),
  ]);

  // The view is month-bucketed, so a month in which nobody ordered is simply absent
  // rather than present with a zero. Left as-is, that absence collapses the time
  // axis: a bar chart whose x spacing depends on which months happened to have
  // orders would visually compress a real gap. Backfill every month between the
  // first and last period seen so the axis is calendar-true.
  const periods = [...new Set(regionPeriod.map((row) => row.period))].sort();
  const trend: TrendPoint[] = [];
  if (periods.length > 0) {
    const cursor = new Date(`${periods[0]}-01T00:00:00Z`);
    const last = new Date(`${periods[periods.length - 1]}-01T00:00:00Z`);
    while (cursor <= last) {
      const key = cursor.toISOString().slice(0, 10);
      const rows = regionPeriod.filter((row) => row.period === key);
      trend.push({
        label: monthLabel(key),
        realized: rows.reduce((sum, row) => sum + Number(row.realized_amount), 0),
        pipeline: rows.reduce((sum, row) => sum + Number(row.pipeline_amount), 0),
        rejected: rows.reduce((sum, row) => sum + Number(row.rejected_amount), 0),
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }

  const realizedTotal = regionTotals.reduce((sum, row) => sum + Number(row.realized_amount), 0);
  const pipelineTotal = regionTotals.reduce((sum, row) => sum + Number(row.pipeline_amount), 0);
  const outstandingTotal = byDealer.reduce((sum, row) => sum + Number(row.outstanding_amount), 0);
  const activeRegions = regionTotals.length;
  const collectionRatio = realizedTotal > 0 ? ((realizedTotal - pipelineTotal) / realizedTotal) * 100 : 0;

  return (
    <PortalShell
      description="Realized revenue, uncommitted pipeline, and outstanding dues, split by region and by reporting line. Scope follows your role."
      eyebrow="Sales management portal / reporting"
      profile={profile}
      title="See the shape of the book."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          detail="Approved, dispatched, invoiced"
          label="Realized"
          value={`₹${formatNumber(realizedTotal)}`}
        />
        <MetricCard
          detail="Pending and director-pending"
          label="Pipeline"
          value={`₹${formatNumber(pipelineTotal)}`}
        />
        <MetricCard
          detail="Unpaid invoice balances"
          label="Outstanding"
          value={`₹${formatNumber(outstandingTotal)}`}
        />
        <MetricCard
          detail="Regions with activity in scope"
          label="Territories"
          value={String(activeRegions).padStart(2, "0")}
        />
      </section>

      <div className="mt-6">
        <DataPanel
          description="Realized and pipeline are separate series on purpose. Adding them gives a number that is neither revenue nor risk, and a month with no orders is still shown so the axis stays calendar-true."
          title="Sales trend by period"
        >
          <TrendChart
            description="Calendar months in Asia/Kolkata, matching the reporting timezone used everywhere else in this system."
            points={trend}
            title="Realized against uncommitted demand"
          />
        </DataPanel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <DataPanel
          description="Ranked on realized revenue. A dealer nobody has classified still appears, under its state, rather than vanishing from the total."
          title="Regions"
        >
          {regionTotals.length ? (
            <RankedBars
              description="Green is committed revenue. The trailing figure is the region's uncommitted pipeline."
              emptyMessage="No regional activity is visible in your scope."
              rows={regionTotals.map((row) => ({
                label: row.region,
                value: Number(row.realized_amount),
                secondary: Number(row.pipeline_amount),
                detail: `${row.dealer_count} dealers · ${row.realized_orders} realized orders`,
              }))}
              title="Realized revenue by region"
              valueLabel="All time"
            />
          ) : (
            <EmptyState message="No regional activity is visible in your scope." />
          )}
        </DataPanel>

        <DataPanel
          description="Each rep rolled up one level to their manager, so a manager can rank their team without knowing the hierarchy shape."
          title="Reporting lines"
        >
          {byRep.length ? (
            <RankedBars
              emptyMessage="No rep activity is visible in your scope."
              rows={byRep.map((row) => ({
                label: `${row.rep_name} · ${row.region}`,
                value: Number(row.realized_amount),
                secondary: Number(row.pipeline_amount),
                detail: `Reports to ${row.manager_name} · ${row.dealer_count} dealers`,
              }))}
              title="Realized revenue by rep"
              valueLabel="All time"
            />
          ) : (
            <EmptyState message="No rep activity is visible in your scope." />
          )}
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel
          description="Proportion of each region that has converted. This is the credit question: a region with a long green bar is funding itself, and a short one is asking for headroom."
          title="Committed against uncommitted"
        >
          {regionTotals.length ? (
            <div className="space-y-4">
              {[...regionTotals]
                .sort((a, b) => Number(b.pipeline_amount) - Number(a.pipeline_amount))
                .map((row) => (
                  <SplitBar
                    key={row.region}
                    label={row.region}
                    pipeline={Number(row.pipeline_amount)}
                    realized={Number(row.realized_amount)}
                  />
                ))}
            </div>
          ) : (
            <EmptyState message="Nothing to compare yet." />
          )}
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel
          description="Outstanding is the unpaid balance on raised invoices. It is deliberately not netted against pipeline: an order nobody has approved is not a debt, and treating it as one would double-count the same demand."
          title="Dealer book"
        >
          {byDealer.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                  <tr>
                    <th className="pb-3 pr-4 font-bold">Dealer</th>
                    <th className="pb-3 pr-4 font-bold">Region</th>
                    <th className="pb-3 pr-4 font-bold">Realized</th>
                    <th className="pb-3 pr-4 font-bold">Pipeline</th>
                    <th className="pb-3 pr-4 font-bold">Invoiced</th>
                    <th className="pb-3 pr-4 font-bold">Open invoices</th>
                    <th className="pb-3 font-bold">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8ede6]">
                  {byDealer.map((row) => (
                    <tr key={row.dealer_id}>
                      <td className="py-3 pr-4 font-semibold">
                        {row.dealer_name}
                        {row.status === "active" ? null : (
                          <span className="ml-2 rounded-full border border-[#f2b8ad] bg-[#fff0ed] px-2 py-0.5 text-xs font-bold text-[#a33a2b]">
                            {row.status}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-[#5d6b60]">{row.region}</td>
                      <td className="py-3 pr-4 text-[#4e741d]">₹{formatNumber(row.realized_amount)}</td>
                      <td className="py-3 pr-4 text-[#276c76]">₹{formatNumber(row.pipeline_amount)}</td>
                      <td className="py-3 pr-4">₹{formatNumber(row.invoiced_amount)}</td>
                      <td className="py-3 pr-4">{formatNumber(row.open_invoices)}</td>
                      <td className="py-3 font-semibold">₹{formatNumber(row.outstanding_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-[#dfe6dc] text-sm">
                  <tr>
                    <td className="py-3 pr-4 font-semibold" colSpan={2}>
                      {byDealer.length} dealers in scope
                    </td>
                    <td className="py-3 pr-4 font-semibold text-[#4e741d]">₹{formatNumber(realizedTotal)}</td>
                    <td className="py-3 pr-4 font-semibold text-[#276c76]">₹{formatNumber(pipelineTotal)}</td>
                    <td className="py-3 pr-4" />
                    <td className="py-3 pr-4" />
                    <td className="py-3 font-semibold">₹{formatNumber(outstandingTotal)}</td>
                  </tr>
                  <tr>
                    <td className="py-1 text-xs text-[#819083]" colSpan={7}>
                      {realizedTotal > 0
                        ? `Realized revenue is ${Math.max(collectionRatio, 0).toFixed(0)}% of committed-plus-open demand.`
                        : "No committed revenue in scope yet."}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <EmptyState message="No dealer accounts are visible in your scope." />
          )}
        </DataPanel>
      </div>
    </PortalShell>
  );
}
