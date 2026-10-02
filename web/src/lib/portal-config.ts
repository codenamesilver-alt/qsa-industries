import type { UserRole } from "./auth";

export type Portal = "internal" | "sales" | "dealer";

export type PortalConfig = {
  title: string;
  description: string;
  destination: string;
  allowedRoles: readonly UserRole[];
  // What signing in here actually gets you, on the sign-in screen itself. Someone
  // standing at this page has not seen a menu yet, so this is the only place the
  // answer to "what would I get" can live.
  highlights: readonly string[];
};

export const portalConfig: Record<Portal, PortalConfig> = {
  internal: {
    title: "Internal operations",
    description: "Production, quality, inventory, logistics, finance, and administration access.",
    destination: "/internal",
    allowedRoles: ["admin", "production_manager", "inventory_manager", "qc_staff", "logistics", "finance"],
    highlights: [
      "Production runs, quality checks and purchasing",
      "Stock levels, deliveries and dispatch",
      "Finance, user administration and the organization chart",
    ],
  },
  sales: {
    title: "Sales management",
    description: "Territory coverage, dealer accounts, approvals, and commercial operations.",
    destination: "/sales",
    allowedRoles: ["sales_rep", "sales_manager", "sales_director"],
    highlights: [
      "Your dealers, your territory and your orders",
      "Approvals that escalate to a director",
      "Sales reporting and your own team",
    ],
  },
  dealer: {
    title: "Dealer portal",
    description: "Account details, catalog pricing, orders, and delivery visibility.",
    destination: "/dealer",
    allowedRoles: ["dealer"],
    highlights: [
      "Your account and credit position",
      "The catalog at your dealer prices",
      "Place orders and follow them through delivery",
    ],
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
