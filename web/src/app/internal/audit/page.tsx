import { DataPanel, EmptyState } from "../../../components/data-panel";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";
import { formatDate, formatNumber } from "../../../lib/format";

const roles = ["admin"] as const;

export default async function AuditPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100");

  return (
    <PortalShell
      description="Append-only record of significant actions: logins, invoices, expenses, orders."
      eyebrow="Internal operations / admin"
      highlights={["Every significant action is recorded with user, time and IP."]}
      profile={profile}
      title="Audit log"
    >
      <DataPanel title="Recent activity">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr>
                  <th className="pb-3 pr-4 font-bold">Time</th>
                  <th className="pb-3 pr-4 font-bold">User</th>
                  <th className="pb-3 pr-4 font-bold">Action</th>
                  <th className="pb-3 pr-4 font-bold">Entity</th>
                  <th className="pb-3 font-bold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 text-xs text-[#819083]">{formatDate(r.created_at)}</td>
                    <td className="py-3 pr-4">{r.user_id ?? "—"}</td>
                    <td className="py-3 pr-4 font-semibold">{r.action}</td>
                    <td className="py-3 pr-4">{r.entity_type ?? "—"} {r.entity_id ? r.entity_id.slice(0, 8) : ""}</td>
                    <td className="py-3 text-xs text-[#5d6b60]">{r.details ? JSON.stringify(r.details).slice(0, 80) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No audit entries yet." />
        )}
      </DataPanel>
    </PortalShell>
  );
}
