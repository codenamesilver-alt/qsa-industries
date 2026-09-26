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
//
// The stock_movements_apply_level trigger (after insert or update or delete) makes
// current_quantity a pure function of the ledger, so the level of every product
// must equal the signed sum of its movements. Checking that for all products
// rather than one spot SKU is what would have caught the original insert-only
// trigger, and it is the check to re-run after anything edits movements.
const levels = await db.query(
  `select p.sku,
          p.name,
          coalesce(sl.current_quantity, 0)::numeric as current_quantity,
          coalesce(sum(case m.movement_type when 'in' then m.quantity else -m.quantity end), 0)::numeric as ledger
   from public.products p
   left join public.stock_levels sl on sl.product_id = p.id
   left join public.stock_movements m on m.product_id = p.id
   group by p.sku, p.name, sl.current_quantity
   order by p.sku`,
);

console.log(`\nstock levels vs ledger (${levels.rowCount} products)`);
let drift = 0;
for (const r of levels.rows) {
  const diff = Number(r.current_quantity) - Number(r.ledger);
  const ok = diff === 0;
  if (!ok) drift += 1;
  console.log(
    `  ${ok ? "  " : "!!"} ${r.sku.padEnd(18)} level ${String(r.current_quantity).padStart(9)}  ` +
      `ledger ${String(r.ledger).padStart(9)}  ${r.name}`,
  );
}
console.log(
  drift === 0
    ? "  every level equals the signed sum of its movements"
    : `  DRIFT: ${drift} product(s) where the level disagrees with the ledger`,
);

const available = await db.query(
  "select available_quantity::numeric as available_quantity from public.dealer_catalog where sku = $1",
  [SKU],
);
console.log(
  `\n${SKU}: dealer-available ${available.rows[0]?.available_quantity ?? "?"} ` +
    `(RLS catalog view, distinct from the level above)`,
);

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
