import { DataPanel, EmptyState } from "../../components/data-panel";
import { PortalShell } from "../../components/portal-shell";
import { requireProfile } from "../../lib/auth";
import { query } from "../../lib/db";
import Link from "next/link";

const allRoles = ["admin", "production_manager", "inventory_manager", "qc_staff", "logistics", "finance", "sales_rep", "sales_manager", "sales_director", "dealer"] as const;

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const profile = await requireProfile(allRoles);
  const sp = await searchParams;
  const q = (sp.q || "").trim();
  const like = `%${q}%`;

  const products = q ? await query<any>("SELECT id, name, sku FROM products WHERE active=1 AND (name LIKE ? OR sku LIKE ?) LIMIT 20", [like, like]) : [];
  const dealers = q ? await query<any>("SELECT id, name, email, phone, region FROM dealers WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? OR region LIKE ? LIMIT 20", [like, like, like, like]) : [];
  const users = q ? await query<any>("SELECT id, full_name, email, phone, role FROM users WHERE is_active=1 AND (full_name LIKE ? OR email LIKE ? OR phone LIKE ? OR role LIKE ?) LIMIT 20", [like, like, like, like]) : [];
  const orders = q ? await query<any>("SELECT o.id, o.status, o.total_amount, d.name AS dealer_name FROM orders o LEFT JOIN dealers d ON d.id=o.dealer_id WHERE o.id LIKE ? OR d.name LIKE ? OR o.status LIKE ? LIMIT 20", [like, like, like]) : [];
  const invoices = q ? await query<any>("SELECT id, invoice_number, dealer_id, total_amount, invoice_date FROM invoices WHERE invoice_number LIKE ? LIMIT 20", [like]) : [];
  const pos = q ? await query<any>("SELECT id, po_number, supplier_name, status FROM purchase_orders WHERE po_number LIKE ? OR supplier_name LIKE ? LIMIT 20", [like, like]) : [];
  const designations = q ? await query<any>("SELECT id, name FROM designations WHERE name LIKE ? LIMIT 20", [like]) : [];
  const tickets = q ? await query<any>("SELECT id, ticket_number, subject, status FROM tickets WHERE ticket_number LIKE ? OR subject LIKE ? LIMIT 20", [like, like]) : [];
  const leads = q ? await query<any>("SELECT id, name, company, status FROM leads WHERE name LIKE ? OR company LIKE ? OR email LIKE ? LIMIT 20", [like, like, like]) : [];

  const total = products.length + dealers.length + users.length + orders.length + invoices.length + pos.length + designations.length + tickets.length + leads.length;

  function Section({ title, rows, render }: { title: string; rows: any[]; render: (r: any) => React.ReactNode }) {
    if (!rows.length) return null;
    return (
      <DataPanel title={`${title} (${rows.length})`}>
        <div className="space-y-2">{rows.map((r) => render(r))}</div>
      </DataPanel>
    );
  }

  return (
    <PortalShell description="Search across the entire ERP: products, dealers, staff, orders, invoices, purchase orders, tickets, leads and more." eyebrow="Search" highlights={["Type a name, number, SKU, region or phone to find anything."]} profile={profile} title="Search">
      <form action="/search" className="mb-6 flex gap-2" method="get">
        <input className="flex-1 rounded-2xl border border-[#d6e1ce] bg-white px-4 py-3 text-sm outline-none focus:border-[#6f8c3b] focus:ring-4 focus:ring-[#d8f35b]/40" name="q" placeholder="Search anything…" type="text" defaultValue={q} />
        <button className="rounded-2xl bg-[#15221b] px-5 py-3 text-sm font-bold text-[#d8f35b]" type="submit">Search</button>
      </form>

      {!q ? (
        <EmptyState message="Type a query above to search across the ERP." />
      ) : total === 0 ? (
        <EmptyState message={`No results for "${q}".`} />
      ) : (
        <div className="space-y-6">
          <Section title="Products" rows={products} render={(r) => (
            <Link className="block rounded-xl border border-[#e8ede6] p-3 hover:bg-[#f5f7f2]" href="/internal/inventory" key={r.id}>
              <p className="font-semibold">{r.name}</p>
              <p className="text-xs text-[#819083]">SKU: {r.sku}</p>
            </Link>
          )} />
          <Section title="Dealers" rows={dealers} render={(r) => (
            <Link className="block rounded-xl border border-[#e8ede6] p-3 hover:bg-[#f5f7f2]" href="/internal/admin/dealers" key={r.id}>
              <p className="font-semibold">{r.name}</p>
              <p className="text-xs text-[#819083]">{r.email ?? ""} · {r.phone ?? ""} · {r.region}</p>
            </Link>
          )} />
          <Section title="Staff" rows={users} render={(r) => (
            <Link className="block rounded-xl border border-[#e8ede6] p-3 hover:bg-[#f5f7f2]" href="/internal/users" key={r.id}>
              <p className="font-semibold">{r.full_name}</p>
              <p className="text-xs text-[#819083]">{r.email} · {r.phone ?? ""} · {r.role}</p>
            </Link>
          )} />
          <Section title="Orders" rows={orders} render={(r) => (
            <Link className="block rounded-xl border border-[#e8ede6] p-3 hover:bg-[#f5f7f2]" href="/sales/orders" key={r.id}>
              <p className="font-semibold">{r.dealer_name ?? "Order"} · {r.status}</p>
              <p className="text-xs text-[#819083]">ID: {r.id} · ₹{r.total_amount}</p>
            </Link>
          )} />
          <Section title="Invoices" rows={invoices} render={(r) => (
            <Link className="block rounded-xl border border-[#e8ede6] p-3 hover:bg-[#f5f7f2]" href="/internal/finance" key={r.id}>
              <p className="font-semibold">{r.invoice_number}</p>
              <p className="text-xs text-[#819083]">₹{r.total_amount} · {r.invoice_date}</p>
            </Link>
          )} />
          <Section title="Purchase orders" rows={pos} render={(r) => (
            <Link className="block rounded-xl border border-[#e8ede6] p-3 hover:bg-[#f5f7f2]" href="/internal/purchasing" key={r.id}>
              <p className="font-semibold">{r.po_number} · {r.supplier_name}</p>
              <p className="text-xs text-[#819083]">{r.status}</p>
            </Link>
          )} />
          <Section title="Designations" rows={designations} render={(r) => (
            <Link className="block rounded-xl border border-[#e8ede6] p-3 hover:bg-[#f5f7f2]" href="/internal/designations" key={r.id}>
              <p className="font-semibold">{r.name}</p>
            </Link>
          )} />
          <Section title="Tickets" rows={tickets} render={(r) => (
            <Link className="block rounded-xl border border-[#e8ede6] p-3 hover:bg-[#f5f7f2]" href="/internal/tickets" key={r.id}>
              <p className="font-semibold">{r.ticket_number} · {r.subject}</p>
              <p className="text-xs text-[#819083]">{r.status}</p>
            </Link>
          )} />
          <Section title="Leads" rows={leads} render={(r) => (
            <Link className="block rounded-xl border border-[#e8ede6] p-3 hover:bg-[#f5f7f2]" href="/internal/leads" key={r.id}>
              <p className="font-semibold">{r.name}</p>
              <p className="text-xs text-[#819083]">{r.company ?? ""} · {r.status}</p>
            </Link>
          )} />
        </div>
      )}
    </PortalShell>
  );
}
