import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";
import { formatNumber } from "../../../lib/format";

const roles = ["admin", "finance"] as const;

export default async function BankPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM bank_accounts ORDER BY name");

  return (
    <PortalShell description="Bank accounts and reconciliation." eyebrow="Internal operations / finance" highlights={["Manage bank accounts."]} profile={profile} title="Bank accounts">
      <DataPanel title="Account register">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Name</th><th className="pb-3 pr-4 font-bold">Bank</th><th className="pb-3 pr-4 font-bold">Account #</th><th className="pb-3 font-bold">Balance</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-semibold">{r.name}</td>
                    <td className="py-3 pr-4">{r.bank_name ?? "—"}</td>
                    <td className="py-3 pr-4">{r.account_number ?? "—"}</td>
                    <td className="py-3">₹{formatNumber(r.balance ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No bank accounts yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Add bank account">
          <QuickCreateForm endpoint="/api/bank-accounts" fields={[
            { name: "name", label: "Name", required: true },
            { name: "bank_name", label: "Bank name" },
            { name: "account_number", label: "Account number" },
            { name: "balance", label: "Opening balance", type: "number" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
