"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Profile, UserRole } from "../lib/auth";
import { isSuperuser } from "../lib/roles";

const linksByRole: Partial<Record<UserRole, Array<{ href: string; label: string }>>> = {
  admin: [
    { href: "/internal", label: "Dashboard" },
    { href: "/internal/assets", label: "Assets" },
    { href: "/internal/attendance", label: "Attendance" },
    { href: "/internal/audit", label: "Audit log" },
    { href: "/internal/bank", label: "Bank accounts" },
    { href: "/internal/bank-statements", label: "Bank statements" },
    { href: "/internal/communications", label: "Communications" },
    { href: "/internal/credit-notes", label: "Credit notes" },
    { href: "/internal/admin/dealers", label: "Dealer onboarding" },
    { href: "/internal/demand-forecasts", label: "Demand forecasts" },
    { href: "/internal/departments", label: "Departments" },
    { href: "/internal/delivery", label: "Delivery board" },
    { href: "/internal/delivery-tracking", label: "Delivery tracking" },
    { href: "/internal/designations", label: "Designations" },
    { href: "/internal/discount-schemes", label: "Discount schemes" },
    { href: "/internal/orders", label: "Dispatch queue" },
    { href: "/internal/employees", label: "Employees" },
    { href: "/internal/finance", label: "Finance" },
    { href: "/internal/periods", label: "Financial periods" },
    { href: "/internal/inventory", label: "Inventory" },
    { href: "/internal/leads", label: "Leads" },
    { href: "/internal/leave", label: "Leave" },
    { href: "/internal/modules", label: "Modules hub" },
    { href: "/internal/notifications", label: "Notifications" },
    { href: "/internal/opportunities", label: "Opportunities" },
    { href: "/internal/org-chart", label: "Organization" },
    { href: "/internal/payroll", label: "Payroll" },
    { href: "/internal/production", label: "Production" },
    { href: "/internal/purchasing", label: "Purchasing" },
    { href: "/internal/quality", label: "Quality" },
    { href: "/internal/quotations", label: "Quotations" },
    { href: "/internal/reorder-rules", label: "Reorder rules" },
    { href: "/internal/roles-permissions", label: "Roles & permissions" },
    { href: "/sales/reports", label: "Reporting" },
    { href: "/internal/payslips", label: "Salary slips" },
    { href: "/sales/orders", label: "Sales orders" },
    { href: "/internal/tickets", label: "Tickets" },
    { href: "/internal/visit-reports", label: "Visit reports" },
    { href: "/internal/settings", label: "Settings" },
  ],
  production_manager: [
    { href: "/internal", label: "Dashboard" },
    { href: "/internal/inventory", label: "Inventory" },
    { href: "/internal/purchasing", label: "Purchasing" },
    { href: "/internal/production", label: "Production" },
    { href: "/internal/quality", label: "Quality" },
    { href: "/internal/org-chart", label: "Organization" },
  ],
  inventory_manager: [
    { href: "/internal", label: "Dashboard" },
    { href: "/internal/inventory", label: "Inventory" },
    { href: "/internal/purchasing", label: "Purchasing" },
    { href: "/internal/org-chart", label: "Organization" },
  ],
  qc_staff: [
    { href: "/internal", label: "Dashboard" },
    { href: "/internal/quality", label: "Quality" },
    { href: "/internal/org-chart", label: "Organization" },
  ],
  logistics: [
    { href: "/internal", label: "Dashboard" },
    { href: "/internal/delivery", label: "Delivery board" },
    { href: "/internal/orders", label: "Dispatch queue" },
    { href: "/internal/org-chart", label: "Organization" },
  ],
  finance: [
    { href: "/internal", label: "Dashboard" },
    { href: "/internal/finance", label: "Finance" },
    { href: "/internal/org-chart", label: "Organization" },
    { href: "/internal/purchasing", label: "Purchasing" },
    { href: "/sales/reports", label: "Reporting" },
  ],
  sales_rep: [
    { href: "/sales", label: "Dashboard" },
    { href: "/sales/orders", label: "Orders" },
    { href: "/sales/reports", label: "My reporting" },
  ],
  sales_manager: [
    { href: "/sales", label: "Dashboard" },
    { href: "/sales/orders", label: "Approvals" },
    { href: "/sales/reports", label: "Team reporting" },
    { href: "/sales/team", label: "Team" },
  ],
  sales_director: [
    { href: "/sales", label: "Dashboard" },
    { href: "/sales/orders", label: "Director queue" },
    { href: "/sales/reports", label: "Oversight" },
  ],
  dealer: [
    { href: "/dealer", label: "Dashboard" },
    { href: "/dealer/catalog", label: "Catalog" },
    { href: "/dealer/orders", label: "My orders" },
  ],
};

const superuserNavByPrefix: ReadonlyArray<readonly [string, Array<{ href: string; label: string }>]> = [
  [
    "/dealer",
    [
      { href: "/dealer", label: "Dashboard" },
      { href: "/dealer/catalog", label: "Catalog" },
      { href: "/dealer/orders", label: "Orders" },
    ],
  ],
  [
    "/sales",
    [
      { href: "/sales", label: "Dashboard" },
      { href: "/sales/orders", label: "Orders & approvals" },
      { href: "/sales/reports", label: "Reporting" },
      { href: "/sales/team", label: "Team" },
    ],
  ],
];

export function PortalNav({ profile }: { profile: Profile }) {
  const pathname = usePathname();

  let links: Array<{ href: string; label: string }>;
  if (profile.role === "admin") {
    links = linksByRole.admin ?? [];
  } else if (isSuperuser(profile.role)) {
    const match = superuserNavByPrefix.find(([prefix]) => pathname.startsWith(prefix));
    links = match ? match[1] : (linksByRole[profile.role] ?? []);
  } else {
    links = linksByRole[profile.role] ?? [];
  }

  return (
    <nav aria-label="Portal navigation" className="nav grid gap-1.5">
      {links.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-[13px] px-3 py-2.5 text-[13px] transition-all duration-150 ${
              active
                ? "bg-[#baff48] font-bold text-[#25311f] shadow-[4px_4px_10px_#d9dcd5,-4px_-4px_10px_#fff]"
                : "text-[#758079] hover:bg-[#e9ebe4] hover:text-[#27312d]"
            }`}
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
