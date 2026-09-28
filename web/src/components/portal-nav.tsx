import Link from "next/link";
import type { Profile, UserRole } from "../lib/auth";

const linksByRole: Partial<Record<UserRole, Array<{ href: string; label: string }>>> = {
  admin: [
    { href: "/internal", label: "Overview" },
    { href: "/internal/inventory", label: "Inventory" },
    { href: "/internal/purchasing", label: "Purchasing" },
    { href: "/internal/production", label: "Production" },
    { href: "/internal/quality", label: "Quality" },
    { href: "/internal/finance", label: "Finance" },
    { href: "/internal/orders", label: "Dispatch queue" },
    { href: "/internal/delivery", label: "Delivery board" },
    { href: "/internal/admin", label: "Administration" },
    { href: "/sales/orders", label: "Sales orders" },
    { href: "/sales/reports", label: "Reporting" },
  ],
  production_manager: [
    { href: "/internal", label: "Overview" },
    { href: "/internal/inventory", label: "Inventory" },
    { href: "/internal/purchasing", label: "Purchasing" },
    { href: "/internal/production", label: "Production" },
    { href: "/internal/quality", label: "Quality" },
  ],
  inventory_manager: [
    { href: "/internal", label: "Overview" },
    { href: "/internal/inventory", label: "Inventory" },
    { href: "/internal/purchasing", label: "Purchasing" },
  ],
  // qc_staff exists in the database role enum and in the SELECT policy on
  // production_runs, but had no route and no nav entry until now, so a QC user
  // could sign in and land nowhere they could act.
  qc_staff: [
    { href: "/internal", label: "Overview" },
    { href: "/internal/quality", label: "Quality" },
  ],
  // The delivery board is a separate route from the dispatch queue because it is
  // a different question: dispatch asks which approved order needs a vehicle,
  // delivery asks which vehicle has not been confirmed as received.
  logistics: [
    { href: "/internal", label: "Overview" },
    { href: "/internal/orders", label: "Dispatch queue" },
    { href: "/internal/delivery", label: "Delivery board" },
  ],
  finance: [
    { href: "/internal", label: "Overview" },
    { href: "/internal/purchasing", label: "Purchasing" },
    { href: "/internal/finance", label: "Finance" },
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
  sales_manager: [
    { href: "/sales", label: "Overview" },
    { href: "/sales/orders", label: "Approvals" },
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

  return (
    <nav aria-label="Portal navigation" className="mb-8 flex flex-wrap gap-2">
      {links.map((link) => (
        <Link
          className="rounded-full border border-[#d6e1ce] bg-white px-4 py-2 text-xs font-bold text-[#4f6254] transition hover:border-[#9db56a] hover:text-[#15221b]"
          href={link.href}
          key={link.href}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
