import { DataPanel, EmptyState } from "../../../../components/data-panel";
import { QuickCreateForm } from "../../../../components/quick-create-form";
import { PortalShell } from "../../../../components/portal-shell";
import { requireProfile } from "../../../../lib/auth";
import { getModule } from "../../../../lib/modules-config";
import { query } from "../../../../lib/db";
import { notFound } from "next/navigation";

const roles = ["admin"] as const;

export default async function ModulePage({ params }: { params: Promise<{ slug: string }> }) {
  const profile = await requireProfile(roles);
  const { slug } = await params;
  const mod = getModule(slug);
  if (!mod) notFound();

  let rows: any[] = [];
  try {
    rows = await query<any>(`SELECT * FROM ${mod.table} ORDER BY created_at DESC`);
  } catch {
    rows = await query<any>(`SELECT * FROM ${mod.table}`);
  }

  return (
    <PortalShell description={`Manage ${mod.title.toLowerCase()}.`} eyebrow="Internal operations / modules" highlights={[`Create and view ${mod.title.toLowerCase()} records.`]} profile={profile} title={mod.title}>
      <DataPanel title={`${mod.title} register`}>
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                <tr>{mod.columns.map((c) => <th className="pb-3 pr-4 font-bold" key={c}>{c}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-[#e8ede6]">
                {rows.map((r: any) => (
                  <tr key={r.id ?? JSON.stringify(r)}>
                    {mod.columns.map((c) => <td className="py-3 pr-4" key={c}>{String(r[c] ?? "—")}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState message={`No ${mod.title.toLowerCase()} records yet.`} />}
      </DataPanel>
      <div className="mt-6">
        <DataPanel title={`Create ${mod.title}`}>
          <QuickCreateForm endpoint={mod.endpoint} fields={mod.fields} />
        </DataPanel>
      </div>
    </PortalShell>
  );
}
