// Removes an order that a lifecycle run left behind part-way through.
//
//   node scripts/e2e-cleanup.mjs <order-id>
//
// Reversible states, because nothing irreversible has happened yet:
//
//   pending   delete the order, its lines and its approval rows
//   approved  same, and no stock has moved
//   dispatched also delete the stock_movements rows the dispatch inserted
//
// Refuses `invoiced` or `rejected`. An invoiced order owns an invoice, a
// dealer_ledger row and possibly payments; unwinding those is a real accounting
// reversal and must be done deliberately, not by a test helper.
import { connect } from "./lib/db.mjs";

const id = process.argv[2];
if (!id) {
  console.error("Usage: node scripts/e2e-cleanup.mjs <order-id>");
  process.exit(2);
}

const REVERSIBLE = ["pending", "approved", "dispatched"];

const c = connect();
await c.connect();

const found = await c.query(`select status, total_amount, dealer_id from public.orders where id = $1`, [id]);
if (found.rowCount === 0) {
  console.log("order already gone");
  await c.end();
  process.exit(0);
}
const order = found.rows[0];
if (!REVERSIBLE.includes(order.status)) {
  console.error(`refusing: order is ${order.status}, which is past the reversible states (${REVERSIBLE.join(", ")})`);
  await c.end();
  process.exit(2);
}

const blocking = await c.query(
  `select
     (select count(*)::int from public.invoices where order_id = $1) as invoices,
     (select count(*)::int from public.stock_movements where reference_id = $1) as movements,
     (select count(*)::int from public.order_approvals where order_id = $1) as approvals,
     (select count(*)::int from public.order_items where order_id = $1) as items`,
  [id],
);
const b = blocking.rows[0];
if (b.invoices > 0) {
  console.error(`refusing: order has ${b.invoices} invoice(s); this is an accounting reversal, not a cleanup`);
  await c.end();
  process.exit(2);
}

// Stock before, so the reversal can be proven rather than assumed.
const products = await c.query(
  `select oi.product_id, oi.quantity, sl.current_quantity
   from public.order_items oi
   left join public.stock_levels sl on sl.product_id = oi.product_id
   where oi.order_id = $1`,
  [id],
);
const exposureBefore = await c.query(`select private.order_exposure($1)::numeric as e`, [order.dealer_id]);
console.log(`order ${id.slice(0, 8)} is ${order.status}; ${b.items} line(s), ${b.approvals} approval(s), ${b.movements} stock movement(s)`);

await c.query("begin");
try {
  if (b.movements > 0) {
    const removed = await c.query(
      `delete from public.stock_movements where reference_id = $1 and source = 'sales'
       returning product_id, quantity, movement_type`,
      [id],
    );
    console.log(`removed ${removed.rowCount} stock movement(s)`);

    // stock_movements_apply_level is AFTER INSERT FOR EACH ROW, so deleting a
    // movement does not put stock_levels back. Undo the level change here, or
    // the reversal would leave stock permanently understated.
    for (const mv of removed.rows) {
      const sign = mv.movement_type === "in" ? -1 : 1;
      await c.query(
        `update public.stock_levels
         set current_quantity = current_quantity + ($2 * $3), updated_at = now()
         where product_id = $1`,
        [mv.product_id, sign, mv.quantity],
      );
      console.log(
        `restored stock_levels ${mv.product_id.slice(0, 8)} by ${sign * Number(mv.quantity)} ` +
          `(${mv.movement_type} of ${mv.quantity})`,
      );
    }
  }
  await c.query(`delete from public.order_approvals where order_id = $1`, [id]);
  await c.query(`delete from public.order_items where order_id = $1`, [id]);
  await c.query(`delete from public.orders where id = $1`, [id]);
  await c.query("commit");
} catch (error) {
  await c.query("rollback");
  console.error("cleanup failed, rolled back:", error.message);
  await c.end();
  process.exit(1);
}

// Verify the reversal actually restored stock, rather than trusting it.
for (const p of products.rows) {
  const after = await c.query(`select current_quantity from public.stock_levels where product_id = $1`, [p.product_id]);
  const now = after.rows[0] ? after.rows[0].current_quantity : null;
  const delta = now === null ? null : Number(now) - Number(p.current_quantity);
  console.log(
    `stock_levels ${p.product_id.slice(0, 8)}: ${p.current_quantity} -> ${now}` +
      (delta === 0 ? "  (restored)" : `  (moved by ${delta})`),
  );
}

const exposureAfter = await c.query(`select private.order_exposure($1)::numeric as e`, [order.dealer_id]);
const counts = await c.query(
  `select (select count(*)::int from public.orders) as orders,
          (select count(*)::int from public.invoices) as invoices,
          (select count(*)::int from public.payments) as payments,
          (select count(*)::int from public.stock_movements) as movements`,
);
console.log(`exposure ${exposureBefore.rows[0].e} -> ${exposureAfter.rows[0].e}`);
console.log(
  `now orders=${counts.rows[0].orders} invoices=${counts.rows[0].invoices} ` +
    `payments=${counts.rows[0].payments} movements=${counts.rows[0].movements}`,
);

await c.end();
