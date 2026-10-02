import { AdminUserForm } from "../../../components/admin-user-form";
import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { PortalShell } from "../../../components/portal-shell";
import { RecordPicker, type PickerItem } from "../../../components/record-picker";
import { StaffLoginForm } from "../../../components/staff-login-form";
import { SuperAdminForm } from "../../../components/super-admin-form";
import { requireProfile } from "../../../lib/auth";
import { getAdminDealers, getDesignations, getUserDirectory } from "../../../lib/data";
import { statusLabel } from "../../../lib/format";

const roles = ["admin"] as const;

// Account creation and account editing live on this page and nowhere else. They used
// to sit at the bottom of /internal/admin, under the product, dealer and price
// master data, which meant an admin looking for a login had to scroll past the whole
// catalogue. They are separate concerns: this page owns people, roles and reporting
// lines, and /internal/admin owns what the business sells.
//
// Every write still goes through a SECURITY DEFINER function that re-reads the
// caller's role inside the database. The route gate below is a convenience, not the
// control; the functions are.
//
// The super admin is split out of everything below rather than filtered. It is not an
// employee: no job title, no reporting line, no place on the org chart, and it is
// excluded from org_people_tree and org_staff_roster by the database rather than by
// this page. Counting it as an internal login or searching for it among staff accounts
// would be the same mistake made in a different place, so the page keeps it in its own
// panel with its own form, and every staff list and metric below reads `staff`.
export default async function UsersPage() {
  const profile = await requireProfile(roles);
  const [allUsers, dealers, designations] = await Promise.all([
    getUserDirectory(),
    getAdminDealers(),
    getDesignations(),
  ]);

  const superAdmins = allUsers.filter((user) => user.role === "admin");
  const staff = allUsers.filter((user) => user.role !== "admin");

  // Two different lists, and conflating them breaks both pickers. The reporting-line
  // picker needs the two management roles, since a sales_rep reports to a sales_manager
  // and a sales_manager reports to a sales_director.
  const managers = staff
    .filter((user) => user.is_active && (user.role === "sales_manager" || user.role === "sales_director"))
    .map((user) => ({ id: user.user_id, full_name: user.full_name, role: user.role }));
  const dealerOptions = dealers.map((dealer) => ({ id: dealer.id, name: dealer.name }));

  const suspended = staff.filter((user) => !user.is_active);
  const onChart = staff.filter((user) => user.is_active && user.role !== "dealer");

  const items: PickerItem[] = staff.map((user) => ({
    id: user.user_id,
    summary: user.full_name,
    detail: [user.email, statusLabel(user.role), user.designation, user.manager_name ? `reports to ${user.manager_name}` : null]
      .filter(Boolean)
      .join(" · "),
    tags: user.is_active ? null : <SuspendedPill />,
    tagText: user.is_active ? "active" : "suspended",
    searchKeys: [user.email, user.role, user.designation ?? "", user.manager_name ?? "", user.dealer_name ?? ""],
    body: (
      <AdminUserForm
        dealers={dealerOptions}
        designations={designations}
        managers={managers}
        user={user}
      />
    ),
  }));

  const superAdminItems: PickerItem[] = superAdmins.map((user) => ({
    id: user.user_id,
    summary: user.email,
    detail: "Super admin · portal maintenance · not an employee",
    tagText: "super admin",
    body: <SuperAdminForm user={user} />,
  }));

  return (
    <PortalShell
      description="Create staff logins, and change a person's role, job title, reporting line or access in one place. Dealer logins are not made here — they carry a credit decision and a sales rep, so they are created from Dealer onboarding."
      eyebrow="Internal operations / users and roles"
      highlights={[
        "Create a staff login with a role and a reporting line",
        "Search every staff account by name, email, role, job title or manager",
        "Edit role, job title, phone, active flag, dealer link and reporting line together",
        "Reset a password without seeing the old one",
      ]}
      profile={profile}
      title="Users and roles."
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard detail="Staff and dealer logins" label="Accounts" value={String(staff.length).padStart(2, "0")} />
        <MetricCard detail="Employees on the org chart" label="Internal" value={String(onChart.length).padStart(2, "0")} />
        <MetricCard detail={`${suspended.length} suspended`} label="Inactive" value={String(suspended.length).padStart(2, "0")} />
      </section>

      {superAdminItems.length > 0 ? (
        <div className="mt-6">
          <DataPanel
            description="The portal super admin, which exists to run and maintain the portal. It is not an employee: the database excludes it from the organization chart and from the staff rosters, it has no job title and no reporting line, and the form below offers only a password reset, because an employee profile is exactly what this account must never acquire."
            title="Portal super admin"
          >
            <RecordPicker
              emptyMessage="No super admin account is visible."
              items={superAdminItems}
              noMatchMessage="No super admin account matches that."
              placeholder="Search super admin accounts"
              searchLabel="Search super admin accounts"
            />
          </DataPanel>
        </div>
      ) : null}

      <div className="mt-6">
        <DataPanel
          description="The login itself, which no product, dealer or price call can create. The browser calls admin_create_user_account with the admin's own session; the function re-reads the caller's role inside the database and refuses anyone who is not an admin, so no privileged key is involved at any point. The password is typed here, used once to create the sign-in, and then never stored, emailed or shown again — hand it over in person."
          title="Create a staff login"
        >
          <StaffLoginForm designations={designations} managers={managers} />
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel
          description="Name, job title, phone, role, active flag, dealer link and reporting line change together, so the profile and the hierarchy cannot disagree. Type in the box to find an account — by name, email, role, job title or manager — then open only the one you want. The portal super admin is not in this list; it is in its own panel above."
          title="Existing staff accounts"
        >
          <RecordPicker
            emptyMessage="No staff accounts are visible."
            items={items}
            noMatchMessage="No account matches that. Try a name, an email address, a role or a job title."
            placeholder="Search by name, email, role or job title"
            searchLabel="Search staff accounts"
          />
        </DataPanel>
      </div>

      <div className="mt-6">
        <EmptyState message="An email that already has an account is refused on creation rather than reused. Edit that account in the list above instead. Dealer logins cannot be created here at all: they carry a credit decision and a sales rep, so they are created from Dealer onboarding." />
      </div>

      <p className="mt-6 text-xs text-[#718075]">
        Suspending a login is not the same as leaving a seat empty. A suspended person keeps their post on
        the organization chart, marked, because the post is still theirs; a seat nobody holds is shown as
        vacant instead. The last active admin cannot be demoted or suspended, so the system can never be
        locked out of its own administration.
      </p>
    </PortalShell>
  );
}

function SuspendedPill() {
  return (
    <span className="rounded-full border border-[#f2b8ad] bg-[#fff0ed] px-3 py-1 text-xs font-bold text-[#a33a2b]">
      Suspended
    </span>
  );
}
