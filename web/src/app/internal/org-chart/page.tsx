import { EmptyState, MetricCard } from "../../../components/data-panel";
import { DesignationManager } from "../../../components/designation-manager";
import { OrgPeopleBuilder } from "../../../components/org-people-builder";
import { OrgPeopleView } from "../../../components/org-people-view";
import { CollapsiblePanel, PanelStack } from "../../../components/panel-stack";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { getDesignations, getOrgPeople } from "../../../lib/data";
import { buildPeopleTree, flattenPeopleTree } from "../../../lib/org-people-tree";

// Every internal role can see the chart, and only an admin can change it. The list
// is the same six roles the internal portal admits, and it is written out here
// rather than imported from the navigation, because a route that took its own
// permission list from a nav file would be a route whose access depends on a menu.
const roles = [
  "admin",
  "production_manager",
  "inventory_manager",
  "qc_staff",
  "logistics",
  "finance",
] as const;

export default async function OrgChartPage() {
  const profile = await requireProfile(roles);
  const isAdmin = profile.role === "admin";
  const [rows, designations] = await Promise.all([
    getOrgPeople(),
    getDesignations(),
  ]);

  const tree = buildPeopleTree(rows);
  const flat = flattenPeopleTree(rows);
  const heads = rows.filter((row) => row.reports_to_id === null);
  const untitled = rows.filter((row) => row.designation_id === null);
  const deepest = flat.reduce((max, item) => Math.max(max, item.depth), 0);

  // The sales pickers used to live here, for the create form this page no longer
  // has. The sales hierarchy is still fixed three levels deep and still enforced by
  // admin_create_user_account; it is simply edited on /internal/users now.
  return (
    <PortalShell
      description="Who works under whom, as the company is arranged rather than as the permission model is. Anyone on this portal can read it; only an admin can change it."
      eyebrow="Internal operations / organization"
      highlights={[
        "A drawn chart of people you can pan, zoom, fold and search by name, job title or email",
        "The reporting line of every employee, and the job title each of them holds",
        "Move anybody to a new manager, set a job title, or clear every reporting line at once"
      ]}
      profile={profile}
      title="The organization chart."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard detail="Employees on the chart" label="People" value={String(rows.length).padStart(2, "0")} />
        <MetricCard detail="Nobody above them" label="Top heads" value={String(heads.length).padStart(2, "0")} />
        <MetricCard detail="Levels below the top" label="Depth" value={String(deepest + (rows.length ? 1 : 0)).padStart(2, "0")} />
        <MetricCard detail="Awaiting a title" label="Untitled" value={String(untitled.length).padStart(2, "0")} />
      </section>

      {isAdmin && untitled.length > 0 ? (
        <p className="mt-6 rounded-2xl border border-[#f0d79a] bg-[#fff7df] px-4 py-3 text-sm text-[#8b6412]">
          {untitled.length} {untitled.length === 1 ? "person has" : "people have"} a login but no job title:{" "}
          {untitled.slice(0, 8).map((person) => person.full_name).join(", ")}
          {untitled.length > 8 ? ` and ${untitled.length - 8} more` : ""}. A job title is not something
          everybody has, so this is a note rather than a problem. It does matter for the permission screen,
          where a designation is what decides which pages a person may open.
        </p>
      ) : null}

      {heads.length > 1 ? (
        <p className="mt-6 rounded-2xl border border-[#dfe6dc] bg-white px-4 py-3 text-sm text-[#4f6254]">
          {heads.length} people report to nobody, which is how a company with a CEO and partners is shaped:{" "}
          {heads.map((person) => person.full_name).join(", ")}. The partners do not report to the CEO, so
          the chart draws them side by side rather than forcing one under the other.
        </p>
      ) : null}

      <div className="mt-6 space-y-6">
        <PanelStack defaultOpenId="chart">
          <CollapsiblePanel
            description={
              rows.length === 0
                ? "Nobody to draw yet."
                : `${tree.length} top ${tree.length === 1 ? "head" : "heads"}. Drag to move, use the buttons or a pinch to zoom, fold a person to hide their reports, and pick one to read them. A suspended login stays on the chart, marked, because the seat is still theirs.`
            }
            id="chart"
            summary={rows.length ? `${rows.length} people` : "empty"}
            title="The chart"
          >
            {rows.length ? (
              <OrgPeopleView rows={rows} />
            ) : (
              <EmptyState message="No employees yet. An admin adds the first person on the Build the chart section, and everybody else hangs under somebody." />
            )}
          </CollapsiblePanel>

          {isAdmin ? (
            <CollapsiblePanel
              description="Every employee's job title and reporting line. Names, roles, phone numbers, dealer links and passwords are not editable here — a login is created and changed on the Users & Roles screen, because a chart is not where a hire or a role change starts."
              id="build"
              summary={`${rows.length} people`}
              title="Build the chart"
            >
              <OrgPeopleBuilder designations={designations} rows={rows} />
            </CollapsiblePanel>
          ) : null}

          {isAdmin ? (
            <CollapsiblePanel
              description="The list every job title picker draws from: the two account forms, the title picker per person above, and the permission matrix. Add a title here and it appears in all of them at once. Retiring one leaves it on anybody who already holds it, marked, so their record still reads correctly."
              id="titles"
              summary={`${designations.length} titles`}
              title="Job titles"
            >
              <DesignationManager designations={designations} />
            </CollapsiblePanel>
          ) : null}
        </PanelStack>
      </div>
    </PortalShell>
  );
}