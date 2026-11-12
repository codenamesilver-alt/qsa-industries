import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin", "sales_rep", "sales_manager", "sales_director"] as const;

export default async function QuotationsPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM quotations ORDER BY created_at DESC");

  return (
    <PortalShell description="Quotations and proforma invoices." eyebrow="Sales / quotations" highlights={["Create and track quotations."]} profile={profile} title="Quotations">
      <DataPanel title="Quotation register">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Number</th><th className="pb-3 pr-4 font-bold">Dealer</th><th className="pb-3 pr-4 font-bold">Status</th><th className="pb-3 pr-4 font-bold">Valid until</th><th className="pb-3 font-bold">Total</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-semibold">{r.quote_number}</td>
                    <td className="py-3 pr-4">{r.dealer_id}</td>
                    <td className="py-3 pr-4">{r.status}</td>
                    <td className="py-3 pr-4">{r.valid_until ?? "—"}</td>
                    <td className="py-3">₹{r.total_amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No quotations yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Create quotation">
          <QuickCreateForm endpoint="/api/quotations" fields={[
            { name: "quote_number", label: "Quote number", required: true },
            { name: "dealer_id", label: "Dealer ID", required: true },
            { name: "status", label: "Status", options: ["draft", "sent", "accepted", "rejected", "expired"] },
            { name: "valid_until", label: "Valid until", type: "date" },
            { name: "total_amount", label: "Total amount", type: "number" },
            { name: "notes", label: "Notes" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
