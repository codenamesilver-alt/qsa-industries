import { DealerOnboardingCard } from "../../../../components/dealer-onboarding-card";
import { DealerOnboardingForm } from "../../../../components/dealer-onboarding-form";
import { DataPanel, EmptyState, MetricCard } from "../../../../components/data-panel";
import { PortalShell } from "../../../../components/portal-shell";
import { requireProfile } from "../../../../lib/auth";
import {
  getAdminDealers,
  getDealerOnboardings,
  getUserDirectory,
  type DealerOnboardingRow,
} from "../../../../lib/data";
import { formatNumber } from "../../../../lib/format";

const roles = ["admin"] as const;

// Onboarding is a separate route from /internal/admin, and the reason is the
// second question on the admin screen rather than a better one. The dealer master
// there answers "what is true about this account now", and it is long: products,
// every dealer, every price, every user. Onboarding answers "what is between this
// dealer and trading", and it is short and mostly a queue. Putting it on the
// master page would bury four actions for one dealer under every other dealer's
// master form, which is the same reason the manager's rep reassignment lives at
// /sales/team rather than on the sales dashboard.
//
// Every write on this page is a SECURITY DEFINER function that checks the role
// itself, except the login, which goes through an edge function holding the
// service role key. The route gate is a convenience, not the control.
export default async function AdminDealersPage() {
  const profile = await requireProfile(roles);
  const [records, users, dealers] = await Promise.all([
    getDealerOnboardings(),
    getUserDirectory(),
    getAdminDealers(),
  ]);

  // Active sales reps only, and only that role. A dealer mapped to anyone else
  // cannot be ordered for, because create_dealer_order reads dealers.sales_rep_id
  // into a not null orders.sales_rep_id, so offering a wider picker would offer
  // mappings the database refuses and the activation that depends on them.
  const salesReps = users
    .filter((user) => user.is_active && user.role === "sales_rep")
    .map((user) => ({ id: user.user_id, full_name: user.full_name }));

  // The dealer's own email, to prefill the login form. Read from the dealer master
  // rather than added to the board view: the board is a read model of the
  // onboarding record, and a login address is a fact about the login, not about
  // the onboarding. The admin confirms it before submitting either way.
  const dealerEmails: Record<string, string | null> = {};
  for (const dealer of dealers) dealerEmails[dealer.id] = dealer.email;

  // The queue is the open records, and the counts are taken from the stage the
  // database derived rather than from a second pass over the columns here. A
  // count computed in the browser from the same rows is one more place for the
  // stage rule to exist.
  const open = records.filter((record) => record.stage !== "live" && record.stage !== "declined");
  const awaitingCredit = records.filter((record) => record.stage === "awaiting_credit" || record.stage === "paper");
  const refused = records.filter((record) => record.stage === "credit_refused");
  const awaitingLogin = records.filter((record) => record.stage === "awaiting_login");
  const readyToActivate = records.filter((record) => record.stage === "awaiting_activation");
  const closed = records.filter((record) => record.stage === "declined" || record.stage === "deactivated");

  const requestedTotal = open.reduce(
    (sum, record) => sum + (record.credit_limit_requested === null ? 0 : Number(record.credit_limit_requested)),
    0,
  );

  return (
    <PortalShell
      description="Bring a dealer on: the paperwork, the credit decision, the login, the territory, and the moment the account starts trading."
      eyebrow="Internal operations / administration"
      highlights={[
        "Start an onboarding for a prospective dealer",
        "Record the credit decision before a dealer can be activated",
        "Map the dealer to a sales rep",
        "Activate or decline the onboarding",
        "What is still outstanding, and closed records with their outcome",
        "Edit the onboarding application while it is in progress",
      ]}
      profile={profile}
      title="Onboard a dealer."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          detail={`${awaitingCredit.length} waiting on a decision`}
          label="Open onboardings"
          value={String(open.length).padStart(2, "0")}
        />
        <MetricCard
          detail={`${awaitingLogin.length} still waiting on a login`}
          label="Ready to activate"
          value={String(readyToActivate.length).padStart(2, "0")}
        />
        <MetricCard detail="Still refusing, still open" label="Credit refused" value={String(refused.length).padStart(2, "0")} />
        <MetricCard detail="Requested across open records" label="Credit asked for" value={`₹${formatNumber(requestedTotal)}`} />
      </section>

      <div className="mt-6">
        <DataPanel
          description="The dealer is created inactive, uncredited and unmapped, and a record opens saying it is still being onboarded. The rep is not asked for here: territory is often settled after the paperwork, and activation refuses an unmapped dealer."
          title="Start an onboarding"
        >
          <DealerOnboardingForm record={null} />
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel
          description="One card per dealer being brought on, in the order the flow runs. Every action here is one call to a function that names its own refusals."
          title="Onboarding queue"
        >
          {records.length ? (
            <div className="space-y-6">
              {records.map((record) => (
                <DealerOnboardingCard
                  dealerEmail={dealerEmails[record.dealer_id]}
                  key={record.dealer_id}
                  record={record}
                  salesReps={salesReps}
                />
              ))}
            </div>
          ) : (
            <EmptyState message="No dealer is being onboarded. Every account here has been trading since before onboarding existed." />
          )}
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel
          description="The requested limit is what the dealer asked for. It becomes the dealer's limit only when credit is approved and the dealer is activated, and after that finance can change it on the dealer master without this figure following."
          title="What is still outstanding"
        >
          {open.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[#d6e1ce] text-xs uppercase tracking-[0.12em] text-[#718075]">
                    <th className="pb-3 pr-4 font-semibold">Dealer</th>
                    <th className="pb-3 pr-4 font-semibold">Stage</th>
                    <th className="pb-3 pr-4 font-semibold">Still to do</th>
                    <th className="pb-3 font-semibold">Requested</th>
                  </tr>
                </thead>
                <tbody>
                  {open.map((record) => (
                    <OutstandingRow key={record.dealer_id} record={record} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="Nothing outstanding. Every onboarding is closed or live." />
          )}
        </DataPanel>
      </div>

      {closed.length ? (
        <div className="mt-6">
          <DataPanel
            description="Declined and deactivated records, kept because they are the answer to why a dealer is not trading."
            title="Closed records"
          >
            <div className="space-y-3">
              {closed.map((record) => (
                <p className="rounded-xl bg-[#f5f7f2] px-4 py-3 text-sm text-[#5d6b60]" key={record.dealer_id}>
                  <span className="font-semibold text-[#334536]">{record.dealer_name}</span> ·{" "}
                  {record.stage === "declined"
                    ? `declined — ${record.decline_reason ?? "no reason recorded"}`
                    : "deactivated on the dealer master after going live"}
                </p>
              ))}
            </div>
          </DataPanel>
        </div>
      ) : null}

      <p className="mt-6 text-xs text-[#718075]">
        A dealer with no onboarding record is not listed here. That means the account has been trading since
        before onboarding existed, and it is read from the dealer master instead.
      </p>
    </PortalShell>
  );
}

function OutstandingRow({ record }: { record: DealerOnboardingRow }) {
  return (
    <tr>
      <td className="py-3 pr-4 font-semibold">{record.dealer_name}</td>
      <td className="py-3 pr-4 text-[#5d6b60]">{record.stage}</td>
      <td className="py-3 pr-4 text-[#5d6b60]">
        {record.outstanding && record.outstanding.length ? record.outstanding.join(", ") : "—"}
      </td>
      <td className="py-3 text-[#5d6b60]">
        {record.credit_limit_requested === null ? "—" : `₹${formatNumber(record.credit_limit_requested)}`}
      </td>
    </tr>
  );
}
