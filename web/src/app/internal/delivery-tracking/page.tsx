import { DataPanel, EmptyState } from "../../../components/data-panel";
import { QuickCreateForm } from "../../../components/quick-create-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin", "logistics"] as const;

export default async function DeliveryTrackingPage() {
  const profile = await requireProfile(roles);
  const rows = await query<any>("SELECT * FROM delivery_tracking ORDER BY event_time DESC");

  return (
    <PortalShell description="Delivery tracking events." eyebrow="Internal operations / logistics" highlights={["Track deliveries."]} profile={profile} title="Delivery tracking">
      <DataPanel title="Tracking events">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr><th className="pb-3 pr-4 font-bold">Order</th><th className="pb-3 pr-4 font-bold">Carrier</th><th className="pb-3 pr-4 font-bold">Tracking #</th><th className="pb-3 pr-4 font-bold">Status</th><th className="pb-3 font-bold">Time</th></tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4">{r.order_id}</td>
                    <td className="py-3 pr-4">{r.carrier ?? "—"}</td>
                    <td className="py-3 pr-4">{r.tracking_number ?? "—"}</td>
                    <td className="py-3 pr-4">{r.status}</td>
                    <td className="py-3">{r.event_time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message="No tracking events yet." />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title="Add tracking event">
          <QuickCreateForm endpoint="/api/delivery-tracking" fields={[
            { name: "order_id", label: "Order ID", required: true },
            { name: "carrier", label: "Carrier" },
            { name: "tracking_number", label: "Tracking number" },
            { name: "status", label: "Status", options: ["in_transit", "out_for_delivery", "delivered", "exception"] },
            { name: "notes", label: "Notes" },
          ]} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
