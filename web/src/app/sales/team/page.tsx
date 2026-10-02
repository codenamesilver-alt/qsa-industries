import { DealerAssignmentForm } from "../../../components/dealer-assignment-form";
import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { getRepCoverage, getTeamDealers } from "../../../lib/data";
import { formatNumber } from "../../../lib/format";

export default async function SalesTeamPage() {
  // Manager only. A rep has no team to reassign and a director assigns across managers
  // by a different rule, so neither is given this screen rather than being given an
  // empty one. The RPC refuses them too; this only saves them the dead end.
  const profile = await requireProfile(["sales_manager"]);
  const [reps, dealers] = await Promise.all([getRepCoverage(), getTeamDealers()]);

  const held = dealers.filter((dealer) => dealer.sales_rep_id !== null);
  const unassigned = dealers.filter((dealer) => dealer.sales_rep_id === null);
  const realized = reps.reduce((sum, row) => sum + Number(row.realized_amount), 0);
  const pipeline = reps.reduce((sum, row) => sum + Number(row.pipeline_amount), 0);
  const open = unassigned.length ? unassigned[0] : null;

  return (
    <PortalShell
      description="Move a dealer between the reps you manage. Coverage, exposure, and reporting follow the dealer."
      eyebrow="Sales management portal"
      highlights={[
        "Reassign a dealer to a different sales rep",
        "Coverage by rep: dealer count, realized revenue and open exposure per person",
        "Dealer accounts with exposure and credit limit override",
      ]}
      profile={profile}
      title="Rep coverage."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard detail="On your reporting line" label="Active reps" value={String(reps.length).padStart(2, "0")} />
        <MetricCard detail="Visible dealer accounts" label="Dealers held" value={String(held.length).padStart(2, "0")} />
        <MetricCard
          detail={open ? "An admin must claim these" : "Every visible dealer is held"}
          label="Unassigned"
          value={String(unassigned.length).padStart(2, "0")}
        />
        <MetricCard
          detail={`₹${formatNumber(pipeline)} still uncommitted`}
          label="Book realized"
          value={`₹${formatNumber(realized)}`}
        />
      </section>

      <div className="mt-6">
        <DataPanel
          description="A dealer can sit with one rep while another holds several. Moving it here changes who can raise orders for it."
          title="Reassign a dealer"
        >
          <DealerAssignmentForm
            dealers={dealers}
            reps={reps.map((rep) => ({
              rep_id: rep.rep_id,
              rep_name: rep.rep_name,
              dealer_count: Number(rep.dealer_count),
            }))}
          />
        </DataPanel>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <DataPanel
          description="One row per rep, including anyone with no dealers. A rep holding nothing is a coaching problem, not a missing row."
          title="Coverage by rep"
        >
          {reps.length ? (
            <div className="space-y-4">
              {reps.map((rep) => {
                const count = Number(rep.dealer_count);
                const share = held.length ? (count / held.length) * 100 : 0;
                return (
                  <div className="rounded-2xl border border-[#e8ede6] p-4" key={rep.rep_id}>
                    <div className="flex items-baseline justify-between gap-4">
                      <p className="font-semibold">{rep.rep_name}</p>
                      <p className="text-sm text-[#718075]">
                        {count} {count === 1 ? "dealer" : "dealers"}
                      </p>
                    </div>
                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#edf1e9]">
                      <div
                        className="h-full rounded-full bg-[#276c76]"
                        style={{ width: `${Math.max(share, count ? 4 : 0)}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-[#819083]">
                      ₹{formatNumber(rep.realized_amount)} realized · ₹{formatNumber(rep.pipeline_amount)} pipeline
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState message="No active reps report to you yet." />
          )}
        </DataPanel>

        <DataPanel
          description="Every row is a dealer already inside your team. The limit shown is the override where one exists, because that is the number actually charged against."
          title="Dealer accounts"
        >
          {dealers.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#d6e1ce] text-xs uppercase tracking-[0.12em] text-[#718075]">
                    <th className="pb-3 pr-4 font-semibold">Dealer</th>
                    <th className="pb-3 pr-4 font-semibold">Region</th>
                    <th className="pb-3 pr-4 font-semibold">Rep</th>
                    <th className="pb-3 font-semibold">Credit limit</th>
                  </tr>
                </thead>
                <tbody>
                  {dealers.map((dealer) => {
                    const limit = dealer.credit_limit_override ?? dealer.credit_limit;
                    return (
                      <tr className="border-b border-[#eef1ec] last:border-0" key={dealer.dealer_id}>
                        <td className="py-3 pr-4 font-semibold">
                          {dealer.dealer_name}
                          {dealer.status !== "active" ? (
                            <span className="ml-2 text-xs font-normal text-[#a27b25]">{dealer.status}</span>
                          ) : null}
                        </td>
                        <td className="py-3 pr-4 text-[#5d6b60]">{dealer.region}</td>
                        <td className="py-3 pr-4 text-[#5d6b60]">{dealer.rep_name}</td>
                        <td className="py-3 text-[#5d6b60]">
                          {limit === null ? "—" : `₹${formatNumber(limit)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
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
