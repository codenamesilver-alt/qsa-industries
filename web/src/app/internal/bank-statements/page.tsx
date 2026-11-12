import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";
import { formatNumber } from "../../../lib/format";

const roles = ["admin", "finance"] as const;

export default async function BankStatementsPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM bank_statements ORDER BY statement_date DESC");

  return (
    <PortalShell description="Bank statement entries for reconciliation." eyebrow="Internal operations / finance" highlights={["Reconcile bank statements."]} profile={profile} title="Bank statements">
      <DataPanel title="Statement entries">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Date</th><th className="pb-3 pr-4 font-bold">Description</th><th className="pb-3 pr-4 font-bold">Reference</th><th className="pb-3 pr-4 font-bold">Amount</th><th className="pb-3 font-bold">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4">{r.statement_date}</td>
                    <td className="py-3 pr-4">{r.description ?? "—"}</td>
                    <td className="py-3 pr-4">{r.reference ?? "—"}</td>
                    <td className="py-3 pr-4">₹{formatNumber(r.amount)}</td>
                    <td className="py-3">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No bank statement entries yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Add entry">
          <QuickCreateForm endpoint="/api/bank-statements" fields={[
            { name: "statement_date", label: "Date", type: "date", required: true },
            { name: "description", label: "Description" },
            { name: "reference", label: "Reference" },
            { name: "amount", label: "Amount", type: "number", required: true },
            { name: "status", label: "Status", options: ["unmatched", "matched"] },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
