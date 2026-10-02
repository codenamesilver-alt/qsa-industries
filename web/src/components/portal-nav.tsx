"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Profile, UserRole } from "../lib/auth";

const linksByRole: Partial<Record<UserRole, Array<{ href: string; label: string }>>> = {
  // Organization is the one entry that is on every internal list and on no sales
  // or dealer list. The six internal roles can all read the chart, which is the
  // point of it: a warehouse clerk and a finance manager work out of the same
  // shape of the company. Only admin gets the editor under it.
  admin: [
    { href: "/internal", label: "Overview" },
    { href: "/internal/inventory", label: "Inventory" },
    { href: "/internal/purchasing", label: "Purchasing" },
    { href: "/internal/production", label: "Production" },
    { href: "/internal/quality", label: "Quality" },
    { href: "/internal/finance", label: "Finance" },
    { href: "/internal/orders", label: "Dispatch queue" },
    { href: "/internal/delivery", label: "Delivery board" },
    { href: "/internal/org-chart", label: "Organization" },
    { href: "/internal/admin", label: "Administration" },
    // People are their own route, for the same reason onboarding is. "Administration"
    // means what the business sells; this means who works here. Keeping account
    // creation at the bottom of the master data page meant finding a login meant
    // scrolling past the entire product catalogue.
    { href: "/internal/users", label: "Users & Roles" },
    // Onboarding is its own route rather than a section of the admin master: it
    // answers a different question, "what is between this dealer and trading",
    // and that answer is a short queue rather than every product, price and user
    // on one page.
    { href: "/internal/admin/dealers", label: "Dealer onboarding" },
    { href: "/sales/orders", label: "Sales orders" },
    { href: "/sales/reports", label: "Reporting" },
  ],
  production_manager: [
    { href: "/internal", label: "Overview" },
    { href: "/internal/inventory", label: "Inventory" },
    { href: "/internal/purchasing", label: "Purchasing" },
    { href: "/internal/production", label: "Production" },
    { href: "/internal/quality", label: "Quality" },
    { href: "/internal/org-chart", label: "Organization" },
  ],
  inventory_manager: [
    { href: "/internal", label: "Overview" },
    { href: "/internal/inventory", label: "Inventory" },
    { href: "/internal/purchasing", label: "Purchasing" },
    { href: "/internal/org-chart", label: "Organization" },
  ],
  // qc_staff exists in the database role enum and in the SELECT policy on
  // production_runs, but had no route and no nav entry until now, so a QC user
  // could sign in and land nowhere they could act.
  qc_staff: [
    { href: "/internal", label: "Overview" },
    { href: "/internal/quality", label: "Quality" },
    { href: "/internal/org-chart", label: "Organization" },
  ],
  // The delivery board is a separate route from the dispatch queue because it is
  // a different question: dispatch asks which approved order needs a vehicle,
  // delivery asks which vehicle has not been confirmed as received.
  logistics: [
    { href: "/internal", label: "Overview" },
    { href: "/internal/orders", label: "Dispatch queue" },
    { href: "/internal/delivery", label: "Delivery board" },
    { href: "/internal/org-chart", label: "Organization" },
  ],
  finance: [
    { href: "/internal", label: "Overview" },
    { href: "/internal/purchasing", label: "Purchasing" },
    { href: "/internal/finance", label: "Finance" },
    { href: "/internal/org-chart", label: "Organization" },
    // Finance sees every dealer regardless of reporting line, so the reporting
    // views are as much theirs as the director's. The amounts on that screen are
    // the same realized/pipeline/outstanding split the finance screens already use.
    { href: "/sales/reports", label: "Reporting" },
  ],
  sales_rep: [
    { href: "/sales", label: "Overview" },
    { href: "/sales/orders", label: "Orders" },
    { href: "/sales/reports", label: "My reporting" },
  ],
  // Team is manager-only, and deliberately not on the director's list. A director
  // oversees managers, so reassigning a dealer between two managers' reps is an
  // admin action; giving the director a screen whose writes the database refuses
  // would be worse than not offering it.
  sales_manager: [
    { href: "/sales", label: "Overview" },
    { href: "/sales/orders", label: "Approvals" },
    { href: "/sales/team", label: "Team" },
    { href: "/sales/reports", label: "Team reporting" },
  ],
  // PRD Phase 4 asks for a sales director oversight dashboard. The director's own
  // queue is where escalations wait, and this is the wider view across every
  // manager: territory, team, and the credit picture they all sit inside.
  sales_director: [
    { href: "/sales", label: "Overview" },
    { href: "/sales/orders", label: "Director queue" },
    { href: "/sales/reports", label: "Oversight" },
  ],
  dealer: [
    { href: "/dealer", label: "Overview" },
    { href: "/dealer/catalog", label: "Catalog" },
    { href: "/dealer/orders", label: "My orders" },
  ],
};

export function PortalNav({ profile }: { profile: Profile }) {
  const links = linksByRole[profile.role] ?? [];
  const pathname = usePathname();

  return (
    <nav
      aria-label="Portal navigation"
      className="flex flex-col gap-1 rounded-[1.75rem] bg-[#eef3e9] p-1.5 lg:min-h-0 lg:overflow-y-auto"
    >
      {links.map((link) => {
        const active = pathname === link.href;

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={`rounded-[1.25rem] px-4 py-2.5 text-sm font-bold transition-all duration-200 ease-out ${
              active
                ? "bg-[#15221b] text-[#d8f35b] shadow-[0_8px_20px_rgba(21,34,27,0.18)]"
                : "text-[#4f6254] hover:bg-white hover:text-[#15221b]"
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
