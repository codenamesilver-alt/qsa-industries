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
    { href: "/sales/orders", label: "Sales orders" },
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
  logistics: [
    { href: "/internal", label: "Overview" },
    { href: "/internal/orders", label: "Dispatch queue" },
  ],
  finance: [
    { href: "/internal", label: "Overview" },
    { href: "/internal/purchasing", label: "Purchasing" },
    { href: "/internal/finance", label: "Finance" },
  ],
  sales_rep: [
    { href: "/sales", label: "Overview" },
    { href: "/sales/orders", label: "Orders" },
  ],
  sales_manager: [
    { href: "/sales", label: "Overview" },
    { href: "/sales/orders", label: "Approvals" },
  ],
  sales_director: [
    { href: "/sales", label: "Overview" },
    { href: "/sales/orders", label: "Director queue" },
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
