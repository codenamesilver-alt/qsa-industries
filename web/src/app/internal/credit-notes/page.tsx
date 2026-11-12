import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";
import { formatNumber } from "../../../lib/format";

const roles = ["admin", "finance"] as const;

export default async function CreditNotesPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM credit_notes ORDER BY created_at DESC");

  return (
    <PortalShell description="Credit and debit notes." eyebrow="Internal operations / finance" highlights={["Manage credit/debit notes."]} profile={profile} title="Credit / debit notes">
      <DataPanel title="Note register">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Number</th><th className="pb-3 pr-4 font-bold">Type</th><th className="pb-3 pr-4 font-bold">Dealer</th><th className="pb-3 pr-4 font-bold">Reason</th><th className="pb-3 font-bold">Total</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-semibold">{r.note_number}</td>
                    <td className="py-3 pr-4">{r.note_type}</td>
                    <td className="py-3 pr-4">{r.dealer_id}</td>
                    <td className="py-3 pr-4">{r.reason ?? "—"}</td>
                    <td className="py-3">₹{formatNumber(r.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No notes yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Create note">
          <QuickCreateForm endpoint="/api/credit-notes" fields={[
            { name: "note_number", label: "Note number", required: true },
            { name: "dealer_id", label: "Dealer ID", required: true },
            { name: "invoice_id", label: "Invoice ID" },
            { name: "note_type", label: "Type", options: ["credit", "debit"], required: true },
            { name: "reason", label: "Reason" },
            { name: "amount", label: "Amount", type: "number", required: true },
            { name: "gst_amount", label: "GST amount", type: "number" },
            { name: "total_amount", label: "Total", type: "number", required: true },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
