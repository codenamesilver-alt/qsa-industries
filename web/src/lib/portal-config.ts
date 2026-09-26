import type { UserRole } from "./auth";

export type Portal = "internal" | "sales" | "dealer";

export type PortalConfig = {
  title: string;
  description: string;
  destination: string;
  allowedRoles: readonly UserRole[];
};

export const portalConfig: Record<Portal, PortalConfig> = {
  internal: {
    title: "Internal operations",
    description: "Production, inventory, logistics, finance, and administration access.",
    destination: "/internal",
    allowedRoles: ["admin", "production_manager", "inventory_manager", "logistics", "finance"],
  },
  sales: {
    title: "Sales management",
    description: "Territory coverage, dealer accounts, approvals, and commercial operations.",
    destination: "/sales",
    allowedRoles: ["sales_rep", "sales_manager", "sales_director"],
  },
  dealer: {
    title: "Dealer portal",
    description: "Account details, catalog pricing, orders, and delivery visibility.",
    destination: "/dealer",
    allowedRoles: ["dealer"],
  },
};

// Which portal a role belongs to, derived from the same table the login form
// enforces so the two can never disagree.
export function portalForRole(role: string): Portal | null {
  for (const [portal, config] of Object.entries(portalConfig)) {
    if ((config.allowedRoles as readonly string[]).includes(role)) return portal as Portal;
  }
  return null;
}

export function homeForRole(role: string): string {
  const portal = portalForRole(role);
  return portal ? portalConfig[portal].destination : "/login";
}
