import { DataPanel, EmptyState, MetricCard } from "../../../components/data-panel";
import { OrderCheckoutForm } from "../../../components/order-checkout-form";
import { PortalShell } from "../../../components/portal-shell";
import { requireProfile } from "../../../lib/auth";
import { getDealerCatalog } from "../../../lib/data";
import { formatNumber } from "../../../lib/format";

export default async function DealerCatalogPage() {
  const profile = await requireProfile(["dealer"]);
  const catalog = await getDealerCatalog();
  const available = catalog.filter((row) => Number(row.available_quantity) > 0);
  const totalValue = catalog.reduce((sum, row) => sum + Number(row.unit_price), 0);

  return (
    <PortalShell
      description="Browse live stock, use dealer pricing, and submit an order for sales review."
      eyebrow="Dealer portal / catalog"
      profile={profile}
      title="Build your next order."
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <MetricCard detail="Sellable products" label="Catalog items" value={String(catalog.length).padStart(2, "0")} />
        <MetricCard detail="With positive live stock" label="Available now" value={String(available.length).padStart(2, "0")} />
        <MetricCard detail="Indicative one-unit value" label="Catalog value" value={`₹${formatNumber(totalValue)}`} />
      </section>
      <div className="mt-6">
        <DataPanel description="Stock and price values come from server-side RLS-protected queries." title="Product catalog">
          {catalog.length ? (
            <OrderCheckoutForm catalog={catalog} />
          ) : (
            <EmptyState message="No sellable products are available." />
          )}
        </DataPanel>
      </div>
    </PortalShell>
  );
}
