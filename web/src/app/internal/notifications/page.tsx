import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin"] as const;

export default async function NotificationsPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM notifications ORDER BY created_at DESC");

  return (
    <PortalShell description="System notifications and alerts." eyebrow="Internal operations / admin" highlights={["View and create notifications."]} profile={profile} title="Notifications">
      <DataPanel title="Notification list">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Title</th><th className="pb-3 pr-4 font-bold">Body</th><th className="pb-3 pr-4 font-bold">Read</th><th className="pb-3 font-bold">Created</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-semibold">{r.title}</td>
                    <td className="py-3 pr-4">{r.body ?? "—"}</td>
                    <td className="py-3 pr-4">{r.is_read ? "Yes" : "No"}</td>
                    <td className="py-3">{r.created_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No notifications yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Create notification">
          <QuickCreateForm endpoint="/api/notifications" fields={[
            { name: "user_id", label: "User ID (optional)" },
            { name: "title", label: "Title", required: true },
            { name: "body", label: "Body" },
            { name: "link", label: "Link" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
