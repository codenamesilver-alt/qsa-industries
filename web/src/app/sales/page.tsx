import { DataPanel, EmptyState, MetricCard } from "../../components/data-panel";
import { PortalShell } from "../../components/portal-shell";
import { requireProfile } from "../../lib/auth";
import { getDealerExposure, getOrders, getSalesDaily, getStatusSummary } from "../../lib/data";
import { formatDate, formatNumber, statusLabel, statusTone } from "../../lib/format";

const salesRoles = ["sales_rep", "sales_manager", "sales_director"] as const;

export default async function SalesPortalPage() {
  const profile = await requireProfile(salesRoles);
  const [orders, statuses, exposure, daily] = await Promise.all([
    getOrders(),
    getStatusSummary(),
    getDealerExposure(),
    getSalesDaily(),
  ]);
  const pending = orders.filter((order) => order.status === "pending");
  const escalated = orders.filter((order) => order.status === "pending_director_approval");
  const totalExposure = exposure.reduce((sum, row) => sum + Number(row.exposure), 0);

  return (
    <PortalShell
      description="A role-aware sales workspace for territory coverage, dealer accounts, approvals, and commercial flow."
      eyebrow="Sales management portal"
      profile={profile}
      title="Move every account."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard detail="Awaiting review" label="Pending orders" value={String(pending.length).padStart(2, "0")} />
        <MetricCard detail="Needs director decision" label="Escalations" value={String(escalated.length).padStart(2, "0")} />
        <MetricCard detail="Visible dealer order value" label="Open exposure" value={`₹${formatNumber(totalExposure)}`} />
        <MetricCard detail="Across visible accounts" label="Orders tracked" value={String(orders.length).padStart(2, "0")} />
      </section>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <DataPanel description="Status mix is scoped by role and reporting hierarchy." title="Pipeline health">
          {statuses.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {statuses.map((row) => (
                <div className="rounded-2xl border border-[#e8ede6] p-4" key={row.status}>
                  <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(row.status)}`}>{statusLabel(row.status)}</span>
                  <p className="mt-5 text-3xl font-semibold tracking-[-0.05em]">{formatNumber(row.order_count)}</p>
                  <p className="mt-1 text-xs text-[#819083]">₹{formatNumber(row.total_amount)} total value</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No order activity visible in your scope." />
          )}
        </DataPanel>
        <DataPanel description="Exposure uses pending, approved, and director-pending order totals." title="Credit watch">
          {exposure.length ? (
            <div className="space-y-4">
              {exposure.slice(0, 8).map((row) => (
                <div className="flex items-center justify-between gap-4 border-b border-[#e8ede6] pb-3 last:border-0 last:pb-0" key={row.dealer_id}>
                  <div>
                    <p className="font-semibold">{row.dealer_name}</p>
                    <p className="mt-1 text-xs text-[#819083]">Limit ₹{formatNumber(row.credit_limit)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">₹{formatNumber(row.exposure)}</p>
                    <p className="mt-1 text-xs text-[#4e741d]">₹{formatNumber(row.available_credit)} available</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No dealer exposure visible in your scope." />
          )}
        </DataPanel>
       </div>
       <div className="mt-6">
         <DataPanel description="Approved, dispatched, and invoiced value by order date." title="Daily sales">
           {daily.length ? (
             <div className="overflow-x-auto">
               <table className="w-full min-w-[520px] text-left text-sm">
                 <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                   <tr>
                     <th className="pb-3 pr-4 font-bold">Date</th>
                     <th className="pb-3 pr-4 font-bold">Orders</th>
                     <th className="pb-3 pr-4 font-bold">Approved value</th>
                     <th className="pb-3 font-bold">Rejected value</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-[#e8ede6]">
                   {daily.map((row) => (
                     <tr key={row.order_date}>
                       <td className="py-3 pr-4 font-semibold">{formatDate(row.order_date)}</td>
                       <td className="py-3 pr-4">{formatNumber(row.order_count)}</td>
                       <td className="py-3 pr-4 text-[#4e741d]">₹{formatNumber(row.approved_sales_amount)}</td>
                       <td className="py-3 text-[#a33a2b]">₹{formatNumber(row.rejected_amount)}</td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
           ) : (
             <EmptyState message="No daily sales history visible." />
           )}
         </DataPanel>
       </div>
       <div className="mt-6">
         <DataPanel description="Newest visible orders. Use Sales orders for lifecycle actions." title="Recent activity">
          {orders.length ? (
            <div className="divide-y divide-[#e8ede6]">
              {orders.slice(0, 8).map((order) => (
                <div className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0" key={order.id}>
                  <div>
                    <p className="font-semibold">{order.dealer?.name ?? "Dealer"}</p>
                    <p className="mt-1 text-xs text-[#819083]">{formatDate(order.created_at)} · {order.order_items?.length ?? 0} line items</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-semibold">₹{formatNumber(order.total_amount)}</span>
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${statusTone(order.status)}`}>{statusLabel(order.status)}</span>
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
