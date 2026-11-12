import { AdminDealerForm } from "../../../components/admin-dealer-form";
import { AdminPriceListForm } from "../../../components/admin-price-list-form";
import { AdminProductForm } from "../../../components/admin-product-form";
import { EmptyState, MetricCard } from "../../../components/data-panel";
import { CollapsiblePanel, PanelStack } from "../../../components/panel-stack";
import { PortalShell } from "../../../components/portal-shell";
import { RecordPicker, type PickerItem } from "../../../components/record-picker";
import { requireProfile } from "../../../lib/auth";
import {
  getAdminDealers,
  getAdminProducts,
  getPriceLists,
  getUserDirectory,
} from "../../../lib/data";
import { businessDate, formatNumber } from "../../../lib/format";

const roles = ["admin"] as const;

// One string, compared against every price's validity window, so "in force" means the
// same thing on every row instead of being decided per row at render time.
const today = businessDate();

// Every write on this page goes through a SECURITY DEFINER function that checks
// private.current_user_role() itself. That is the shape the rest of the schema
// uses, and it is the only shape that works here: a table grant on products or
// dealers cannot tell an admin from a dealer, so granting the columns this screen
// needs would have handed every signed-in user the ability to reprice the
// catalogue or raise a dealer's own credit limit. The route gate below is a
// convenience, not the control; the functions are.
//
// This page is master data only — what the business sells, and who it sells it to.
// Staff logins and roles moved to /internal/users, and both lists below are now
// collapsed behind a search box. Rendering a full form per catalogue row put this
// page at roughly 25,000 pixels tall, which grew with every product added.
export default async function AdminPage() {
  const profile = await requireProfile(roles);
  const [products, dealers, prices, users] = await Promise.all([
    getAdminProducts(),
    getAdminDealers(),
    getPriceLists(),
    getUserDirectory(),
  ]);

  // The dealer picker is fed active sales reps alone, because create_dealer_order
  // reads dealers.sales_rep_id and admin_upsert_dealer refuses anything else.
  const salesReps = users
    .filter((user) => user.is_active && user.role === "sales_rep")
    .map((user) => ({ id: user.user_id, full_name: user.full_name, role: user.role }));
  const activeDealers = dealers.filter((dealer) => dealer.status === "active");
  const inactiveProducts = products.filter((product) => !product.active);

  const productItems: PickerItem[] = products.map((product) => ({
    id: product.id,
    summary: product.name,
    detail: `${product.sku} · ${product.category} · HSN ${product.hsn_code} · ₹${formatNumber(product.price)}`,
    tags: (
      <>
        {product.active ? null : <Pill tone="bad">Retired</Pill>}
        {product.is_sellable ? null : <Pill tone="quiet">Not sellable</Pill>}
      </>
    ),
    tagText: product.active ? (product.is_sellable ? "active sellable" : "active not sellable") : "retired",
    searchKeys: [product.sku, product.category, product.hsn_code],
    body: <AdminProductForm product={product} />,
  }));

  const dealerItems: PickerItem[] = dealers.map((dealer) => ({
    id: dealer.id,
    summary: dealer.name,
    detail: [dealer.region ?? "No region", dealer.city, dealer.state].filter(Boolean).join(" · "),
    tags: <Pill tone={dealer.status === "active" ? "good" : "bad"}>{dealer.status}</Pill>,
    tagText: dealer.status,
    searchKeys: [dealer.region ?? "", dealer.city ?? "", dealer.state ?? ""],
    body: <AdminDealerForm dealer={dealer} salesReps={salesReps} />,
  }));

  // The price list used to be a table with a <details> editor in every row, which
  // mounted one AdminPriceListForm per price whether or not anyone had opened it —
  // fourteen live forms on a page that also had two create forms and two pickers. It
  // is now a picker, so the editor exists only for the price you actually open.
  const priceItems: PickerItem[] = prices.map((price) => {
    const productName = products.find((product) => product.id === price.product_id)?.name ?? price.product_id.slice(0, 8);
    const scope = price.dealer_id
      ? (dealers.find((dealer) => dealer.id === price.dealer_id)?.name ?? "Dealer")
      : `Tier · ${price.price_tier ?? "—"}`;
    const inForce =
      (!price.valid_from || price.valid_from <= today) && (!price.valid_to || price.valid_to >= today);

    return {
      id: price.id,
      summary: productName,
      detail: `${scope} · ₹${formatNumber(price.price)} · ${price.valid_from ?? "no start"} to ${price.valid_to ?? "open"}`,
      tags: <Pill tone={inForce ? "good" : "quiet"}>{inForce ? "In force" : "Not in force"}</Pill>,
      tagText: inForce ? "in force" : "not in force",
      searchKeys: [productName, scope, price.price_tier ?? "", formatNumber(price.price), price.valid_from ?? "", price.valid_to ?? ""],
      body: <AdminPriceListForm dealers={dealers} entry={price} products={products} />,
    };
  });

  return (
    <PortalShell
      description="Own the product catalogue, the dealer master and the price lists. Staff logins, roles and reporting lines are on the Users & Roles screen."
      eyebrow="Internal operations / administration"
      highlights={[
        "Create and edit products, including unit, pack size and reorder point",
        "Create and edit dealer accounts",
        "Create a price list per product and remove obsolete prices",
        "One section open at a time, and a search box on every list",
      ]}
      profile={profile}
      title="Keep the master data honest."
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard detail={`${inactiveProducts.length} retired`} label="Catalogue products" value={String(products.length).padStart(2, "0")} />
        <MetricCard detail={`${dealers.length - activeDealers.length} not active`} label="Dealers" value={String(dealers.length).padStart(2, "0")} />
        <MetricCard detail="Dealer and tier prices" label="Price list entries" value={String(prices.length).padStart(2, "0")} />
      </section>

      <div className="mt-6 space-y-6">
        <PanelStack defaultOpenId="catalogue">
          <CollapsiblePanel
            description="Search by name, SKU, category or HSN, then open the one product you want to change."
            id="catalogue"
            summary={`${products.length} products`}
            title="Product catalogue"
            helpGuide="01-admin-products"
          >
            <RecordPicker
              collapseAfter={15}
              emptyMessage="The catalogue is empty."
              items={productItems}
              noMatchMessage="No product matches that."
              placeholder="Search products by name, SKU, category or HSN"
              searchLabel="Search the product catalogue"
            />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Every field below is one call to admin_upsert_product. Price edits never rewrite an issued document, because order and invoice lines snapshot the price they were raised at."
            id="create-product"
            title="Create a product"
            helpGuide="01-admin-products"
          >
            <AdminProductForm product={null} />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Search by name, region or city, then open the one dealer you want to change."
            id="dealers"
            summary={`${dealers.length} dealers`}
            title="Dealer master"
            helpGuide="02-admin-dealers"
          >
            <RecordPicker
              collapseAfter={15}
              emptyMessage="No dealer accounts exist yet."
              items={dealerItems}
              noMatchMessage="No dealer matches that."
              placeholder="Search dealers by name, region or city"
              searchLabel="Search the dealer master"
            />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="A dealer cannot be created without a region, and can only be mapped to an active sales rep. Both refusals happen here rather than at order time."
            id="create-dealer"
            title="Create a dealer"
            helpGuide="02-admin-dealers"
          >
            <AdminDealerForm dealer={null} salesReps={salesReps} />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="Every price currently in force. Search by product, dealer or tier, then open the one you want to change."
            id="prices"
            summary={`${prices.length} prices`}
            title="Price list"
            helpGuide="04-price-lists"
          >
            <RecordPicker
              collapseAfter={15}
              emptyMessage="No price list entries exist yet."
              items={priceItems}
              noMatchMessage="No price matches that. Try a product, a dealer or a tier."
              placeholder="Search prices by product, dealer or tier"
              searchLabel="Search the price list"
            />
          </CollapsiblePanel>

          <CollapsiblePanel
            description="A price belongs to one dealer or one tier, never both. Removing one is safe: prices are snapshotted onto the order line when it is raised."
            id="create-price"
            title="Create a price"
            helpGuide="04-price-lists"
          >
            <AdminPriceListForm dealers={dealers} entry={null} products={products} />
          </CollapsiblePanel>
        </PanelStack>
      </div>

      <div className="mt-6">
        <EmptyState message="Staff logins, roles, job titles and reporting lines are on the Users & Roles screen. They used to sit at the bottom of this page, under the whole catalogue." />
      </div>
    </PortalShell>
  );
}

function Pill({ tone, children }: { tone: "good" | "bad" | "quiet"; children: React.ReactNode }) {
  const tones = {
    good: "border-[#b9d98a] bg-[#eff8df] text-[#4e741d]",
    bad: "border-[#f2b8ad] bg-[#fff0ed] text-[#a33a2b]",
    quiet: "border-[#d6e1ce] bg-[#f5f7f2] text-[#4f6254]",
  } as const;
  return <span className={`rounded-full border px-3 py-1 text-xs font-bold ${tones[tone]}`}>{children}</span>;
}
