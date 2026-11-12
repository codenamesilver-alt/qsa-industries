import { DataPanel } from "../../../components/data-panel";
import { RolesPermissionsManager } from "../../../components/roles-permissions-manager";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { query } from "../../../lib/db";

const roles = ["admin"] as const;

export default async function RolesPermissionsPage() {
  const profile = await requireProfile(roles);
  const designations = await query<any>("SELECT id, name FROM designations ORDER BY name");

  return (
    <PortalShell description="Assign read/write/edit/delete/NA permissions per designation." eyebrow="Internal operations / admin" highlights={["Permission matrix by designation."]} profile={profile} title="Roles & permissions">
      <DataPanel title="Permission matrix">
        <RolesPermissionsManager designations={designations} />
      </DataPanel>
    </PortalShell>
  );
}
