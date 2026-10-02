// Role vocabulary and the pure guard predicates, kept apart from auth.ts on purpose.
// auth.ts reaches next/headers through the server Supabase client, so a client
// component may not import it for a value; a type-only import is erased and always
// was fine. Anything a client component calls at runtime lives here.

export const userRoles = [
  "admin",
  "production_manager",
  "inventory_manager",
  "qc_staff",
  "sales_rep",
  "sales_manager",
  "sales_director",
  "logistics",
  "finance",
  "dealer",
] as const;

export type UserRole = (typeof userRoles)[number];

// The portal super admin is the one account admitted everywhere. It exists to run
// and maintain the portal, not to be one of its operators, so it is not an employee
// and carries no single portal role of its own. Without this it could sign in to
// /login/internal and was turned away by /login/sales and /login/dealer, which is
// the wrong way round for the account that has to be able to check all three.
//
// The database already agrees: private.can_view_dealer, private.can_view_price_list,
// public.dealer_catalog_for and public.dealer_credit_summary all grant admin
// explicitly, and the RLS policies on orders, invoices and dealers admit the admin
// role. This is the app half of an authority the database half already has.
export const superuserRoles = ["admin"] as const;

export function isSuperuser(role: string): boolean {
  return (superuserRoles as readonly string[]).includes(role);
}

// Whether a role passes a portal or page guard. A superuser passes every guard;
// anyone else passes only on an exact match, so no other role widens.
export function admitsRole(role: string, allowedRoles: readonly UserRole[]): boolean {
  return isSuperuser(role) || allowedRoles.includes(role as UserRole);
}