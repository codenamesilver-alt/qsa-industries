// Read-only snapshot of the data the lifecycle runs touched. Every statement
// here is a SELECT; nothing in this script can write, so it is safe to point at
// the live project.
//
//   node scripts/e2e-audit.mjs
//
// private.order_exposure() counts only orders in pending, pending_director_approval
// and approved, so an approved -> dispatched move drops exposure by the order
// total. That is the intended accounting, not drift, which is why the audit
// prints the status breakdown instead of one number.
import { connect } from "./lib/db.mjs";

const SKU = process.env.AUDIT_SKU ?? "QSA-BROILER-01";
const NOTE = "E2E dispatch note";
// The dealer the lifecycle run orders as. Hardcoded in ui-lifecycle.mjs too.
const DEALER_ID = process.env.AUDIT_DEALER ?? "20000000-0000-4000-8000-000000000003";

const db = connect();
await db.connect();

// Default to the lifecycle dealer rather than the largest exposure holder: the
// point of this script is to explain the lifecycle runs' own numbers, and a
// dealer with a bigger open book makes those numbers unreadable.
const dealer = await db.query(
  `select d.id, d.name from public.dealers d where d.id = $1`,
  [DEALER_ID],
);
if (dealer.rowCount === 0) {
  console.error("no dealer has any orders; nothing to audit");
  await db.end();
  process.exit(2);
}
const { id: dealerId, name: dealerName } = dealer.rows[0];
console.log(`dealer: ${dealerName} (${dealerId})\n`);

const breakdown = await db.query(
  `select
     coalesce((select sum(o.total_amount) from public.orders o
       where o.dealer_id = $1
         and o.status in ('pending','pending_director_approval','approved')), 0)::numeric
       as open_orders,
     coalesce((select sum(greatest(i.total_amount - coalesce(pa.paid, 0), 0))
       from public.invoices i
       left join lateral (select sum(a.amount) as paid from public.payment_allocations a
                          where a.invoice_id = i.id) pa on true
       where i.dealer_id = $1), 0)::numeric as invoice_outstanding,
     coalesce((select sum(greatest(p.amount - coalesce(pa.paid, 0), 0))
       from public.payments p
       left join lateral (select sum(a.amount) as paid from public.payment_allocations a
                          where a.payment_id = p.id) pa on true
       where p.dealer_id = $1 and p.invoice_id is null
         and p.amount - coalesce(pa.paid, 0) > 0), 0)::numeric as advances,
     (select private.order_exposure($1))::numeric as exposure`,
  [dealerId],
);
const b = breakdown.rows[0];
console.log("exposure breakdown");
console.log(`  open orders (pending / director / approved)  ${b.open_orders}`);
console.log(`  invoice outstanding                          ${b.invoice_outstanding}`);
console.log(`  unallocated advances                         -${b.advances}`);
console.log(`  private.order_exposure()                     ${b.exposure}\n`);

const byStatus = await db.query(
  `select status, count(*)::int as n, coalesce(sum(total_amount), 0)::numeric as total
   from public.orders where dealer_id = $1 group by status order by status`,
  [dealerId],
);
console.log("orders by status");
for (const r of byStatus.rows) console.log(`  ${r.status.padEnd(26)} ${String(r.n).padStart(3)}  ${r.total}`);

const recent = await db.query(
  `select o.id, o.status, o.total_amount, o.tracking_note, o.dispatched_at, o.created_at
   from public.orders o where o.dealer_id = $1
   order by o.created_at desc limit 8`,
  [dealerId],
);
console.log("\n8 most recent orders");
for (const r of recent.rows) {
  console.log(
    `  ${r.id.slice(0, 8)}  ${r.status.padEnd(20)} ${String(r.total_amount).padStart(10)}  ` +
      `created ${r.created_at.toISOString().slice(11, 19)}` +
      (r.dispatched_at ? `  dispatched ${r.dispatched_at.toISOString().slice(11, 19)}` : ""),
  );
}

const e2e = await db.query(
  `select o.id, o.status, o.total_amount, o.tracking_note, o.dispatched_at, o.created_at,
          d.name as dealer_name,
          (select i.invoice_number from public.invoices i where i.order_id = o.id) as invoice_number,
          (select round(coalesce(sum(a.amount), 0), 2) from public.invoices i
            join public.payment_allocations a on a.invoice_id = i.id
           where i.order_id = o.id) as allocated
   from public.orders o
   join public.dealers d on d.id = o.dealer_id
   where o.tracking_note = $1
   order by o.created_at desc`,
  [NOTE],
);
console.log(`\nlifecycle rows (tracking_note = "${NOTE}")`);
if (e2e.rowCount === 0) {
  console.log("  none");
} else {
  for (const r of e2e.rows) {
    console.log(
      `  ${r.id.slice(0, 8)}  ${r.dealer_name.padEnd(14)} ${r.status.padEnd(20)} ${String(r.total_amount).padStart(10)}  ` +
        `invoice ${r.invoice_number ?? "-"}  allocated ${r.allocated}`,
    );
  }
}

// current_quantity lives on stock_levels; available_quantity is derived per dealer
// on the RLS-scoped catalog view, so they are two different numbers on purpose.
const catalog = await db.query(
  `select (select sl.current_quantity::numeric
             from public.stock_levels sl join public.products p on p.id = sl.product_id
            where p.sku = $1) as current_quantity,
          (select available_quantity::numeric from public.dealer_catalog where sku = $1) as available_quantity`,
  [SKU],
);
const c = catalog.rows[0] ?? {};
console.log(`\n${SKU}: current ${c.current_quantity ?? "?"}, available ${c.available_quantity ?? "?"}`);

const counts = await db.query(
  `select (select count(*)::int from public.orders) as orders,
          (select count(*)::int from public.invoices) as invoices,
          (select count(*)::int from public.payments) as payments,
          (select count(*)::int from public.stock_movements) as movements,
          (select count(*)::int from public.order_events) as events`,
);
const k = counts.rows[0];
console.log(
  `\nrow counts: orders=${k.orders} invoices=${k.invoices} payments=${k.payments} ` +
    `movements=${k.movements} events=${k.events}`,
);

await db.end();
