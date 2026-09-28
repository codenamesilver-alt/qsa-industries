import { AdminDealerForm } from "../../../components/admin-dealer-form";
import { AdminPriceListForm } from "../../../components/admin-price-list-form";
import { AdminProductForm } from "../../../components/admin-product-form";
import { AdminUserForm } from "../../../components/admin-user-form";
import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import {
  getAdminDealers,
  getAdminProducts,
  getPriceLists,
  getUserDirectory,
  type AdminDealerRow,
  type AdminProductRow,
  type PriceListRow,
} from "../../../lib/data";
import { formatNumber, statusLabel } from "../../../lib/format";

const roles = ["admin"] as const;

// Every write on this page goes through a SECURITY DEFINER function that checks
// private.current_user_role() itself. That is the shape the rest of the schema
// uses, and it is the only shape that works here: a table grant on products or
// dealers cannot tell an admin from a dealer, so granting the columns this screen
// needs would have handed every signed-in user the ability to reprice the
// catalogue or raise a dealer's own credit limit. The route gate below is a
// convenience, not the control; the functions are.
export default async function AdminPage() {
  const profile = await requireProfile(roles);
  const [products, dealers, prices, users] = await Promise.all([
    getAdminProducts(),
    getAdminDealers(),
    getPriceLists(),
    getUserDirectory(),
  ]);

  // Two different lists, and conflating them breaks both screens. A dealer may
  // only be mapped to an active sales_rep, because create_dealer_order reads
  // dealers.sales_rep_id and admin_upsert_dealer refuses anything else, so the
  // dealer picker is fed reps alone. The reporting-line picker needs the two
  // management roles, since a sales_rep reports to a sales_manager and a
  // sales_manager reports to a sales_director.
  const managers = users
    .filter((user) => user.is_active && (user.role === "sales_manager" || user.role === "sales_director"))
    .map((user) => ({ id: user.user_id, full_name: user.full_name, role: user.role }));
  const salesReps = users
    .filter((user) => user.is_active && user.role === "sales_rep")
    .map((user) => ({ id: user.user_id, full_name: user.full_name, role: user.role }));
  const activeDealers = dealers.filter((dealer) => dealer.status === "active");
  const inactiveProducts = products.filter((product) => !product.active);
  const suspendedUsers = users.filter((user) => !user.is_active);

  return (
    <PortalShell
      description="Own the product catalogue, the dealer master, price lists, and the roles and reporting lines that decide who can see what."
      eyebrow="Internal operations / administration"
      profile={profile}
      title="Keep the master data honest."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard detail={`${inactiveProducts.length} retired`} label="Catalogue products" value={String(products.length).padStart(2, "0")} />
        <MetricCard detail={`${dealers.length - activeDealers.length} not active`} label="Dealers" value={String(dealers.length).padStart(2, "0")} />
        <MetricCard detail="Dealer and tier prices" label="Price list entries" value={String(prices.length).padStart(2, "0")} />
        <MetricCard detail={`${suspendedUsers.length} suspended`} label="Users" value={String(users.length).padStart(2, "0")} />
      </section>

      <div className="mt-6">
        <DataPanel
          description="Every field below is one call to admin_upsert_product. Price edits never rewrite an issued document, because order and invoice lines snapshot the price they were raised at."
          title="Create a product"
        >
          <AdminProductForm product={null} />
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel description="Edit an existing catalogue row." title="Product catalogue">
          {products.length ? (
            <div className="space-y-6">
              {products.map((product) => (
                <div className="rounded-2xl border border-[#e8ede6] p-4" key={product.id}>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{product.name}</p>
                      <p className="mt-1 text-xs text-[#819083]">
                        {product.sku} · {product.category} · HSN {product.hsn_code} · ₹{formatNumber(product.price)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {product.active ? null : (
                        <span className="rounded-full border border-[#f2b8ad] bg-[#fff0ed] px-3 py-1 text-xs font-bold text-[#a33a2b]">
                          Retired
                        </span>
                      )}
                      {product.is_sellable ? null : (
                        <span className="rounded-full border border-[#d6e1ce] bg-[#f5f7f2] px-3 py-1 text-xs font-bold text-[#4f6254]">
                          Not sellable
                        </span>
                      )}
                    </div>
                  </div>
                  <AdminProductForm product={product} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="The catalogue is empty." />
          )}
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel
          description="A dealer cannot be created without a region, and can only be mapped to an active sales rep. Both refusals happen here rather than at order time."
          title="Create a dealer"
        >
          <AdminDealerForm dealer={null} salesReps={salesReps} />
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel description="Dealer master, editable in full." title="Dealer master">
          {dealers.length ? (
            <div className="space-y-6">
              {dealers.map((dealer) => (
                <div className="rounded-2xl border border-[#e8ede6] p-4" key={dealer.id}>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{dealer.name}</p>
                      <p className="mt-1 text-xs text-[#819083]">
                        {dealer.region ?? "No region"} · {dealer.city ?? "—"}
                        {dealer.state ? `, ${dealer.state}` : ""}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 text-xs font-bold ${
                        dealer.status === "active"
                          ? "border-[#b9d98a] bg-[#eff8df] text-[#4e741d]"
                          : "border-[#f2b8ad] bg-[#fff0ed] text-[#a33a2b]"
                      }`}
                    >
                      {dealer.status}
                    </span>
                  </div>
                  <AdminDealerForm dealer={dealer} salesReps={salesReps} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No dealer accounts exist yet." />
          )}
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel
          description="A price belongs to one dealer or one tier, never both. Removing one is safe: prices are snapshotted onto the order line when it is raised."
          title="Create a price"
        >
          <AdminPriceListForm dealers={dealers} entry={null} products={products} />
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel description="Every price currently in force." title="Price list">
          {prices.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-[#e8ede6] text-xs uppercase tracking-[0.16em] text-[#819083]">
                  <tr>
                    <th className="pb-3 pr-4 font-bold">Product</th>
                    <th className="pb-3 pr-4 font-bold">Scope</th>
                    <th className="pb-3 pr-4 font-bold">Price</th>
                    <th className="pb-3 pr-4 font-bold">Valid from</th>
                    <th className="pb-3 pr-4 font-bold">Valid to</th>
                    <th className="pb-3 font-bold">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e8ede6]">
                  {prices.map((price) => (
                    <PriceRow key={price.id} dealers={dealers} entry={price} products={products} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="No price list entries exist yet." />
          )}
        </DataPanel>
      </div>

      <div className="mt-6">
        <DataPanel
          description="Name, role, active flag, dealer link and reporting line change together, so the profile and the hierarchy cannot disagree."
          title="Users, roles and reporting lines"
        >
          {users.length ? (
            <div className="space-y-6">
              {users.map((user) => (
                <div className="rounded-2xl border border-[#e8ede6] p-4" key={user.user_id}>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{user.full_name}</p>
                      <p className="mt-1 text-xs text-[#819083]">
                        {user.email} · {statusLabel(user.role)}
                        {user.manager_name ? ` · reports to ${user.manager_name}` : ""}
                        {user.dealer_name ? ` · ${user.dealer_name}` : ""}
                      </p>
                    </div>
                    {user.is_active ? null : (
                      <span className="rounded-full border border-[#f2b8ad] bg-[#fff0ed] px-3 py-1 text-xs font-bold text-[#a33a2b]">
                        Suspended
                      </span>
                    )}
                  </div>
                  <AdminUserForm
                    dealers={dealers.map((dealer) => ({ id: dealer.id, name: dealer.name }))}
                    managers={managers}
                    user={user}
                  />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No user accounts are visible." />
          )}
        </DataPanel>
      </div>

      <p className="mt-6 text-xs text-[#718075]">
        Account creation is not on this screen and cannot be. It needs the service role key, which must never
        reach a browser, so new logins are still provisioned out of band.
      </p>
    </PortalShell>
  );
}

function PriceRow({
  entry,
  products,
  dealers,
}: {
  entry: PriceListRow;
  products: AdminProductRow[];
  dealers: AdminDealerRow[];
}) {
  return (
    <tr>
      <td className="py-4 pr-4 font-semibold">
        {products.find((product) => product.id === entry.product_id)?.name ?? entry.product_id.slice(0, 8)}
      </td>
      <td className="py-4 pr-4 text-[#5d6b60]">
        {entry.dealer_id
          ? dealers.find((dealer) => dealer.id === entry.dealer_id)?.name ?? "Dealer"
          : `Tier · ${entry.price_tier ?? "—"}`}
      </td>
      <td className="py-4 pr-4 font-semibold">₹{formatNumber(entry.price)}</td>
      <td className="py-4 pr-4 text-[#5d6b60]">{entry.valid_from ?? "—"}</td>
      <td className="py-4 pr-4 text-[#5d6b60]">{entry.valid_to ?? "—"}</td>
      <td className="py-4">
        <details>
          <summary className="cursor-pointer text-xs font-bold text-[#4f6254]">Edit</summary>
          <div className="mt-4 min-w-[420px]">
            <AdminPriceListForm dealers={dealers} entry={entry} products={products} />
          </div>
        </details>
      </td>
    </tr>
  );
}
