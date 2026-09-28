# Report 007 of 009 - Order Editing, Place of Supply, Shippable Batches, and Regional Reporting

| Field | Value |
| --- | --- |
| Report | 007 of 009 |
| Date | 28 September 2026 |
| Milestone | Six migrations, four reporting views, a reporting screen with hand-rolled SVG charts, and 168 new assertions across three pgTAP suites |
| Status | **Complete, except two items that are blocked and not silently dropped** |
| Previous report | `006-admin-and-delivery-with-a-real-lifecycle.md` |
| Next report | `008-*.md` (not yet written) |

> To resume: pick the highest-numbered report in `reports/`. Reports are
> append-only and never renumbered.

---

## Milestone outcome

This milestone closed four separate gaps, three of which were found while building
the screen that needed them rather than by reading the PRD:

1. **A pending dealer order could not be corrected.** The only edit path was to
   reject and re-raise, which loses the order history and the dealer has to do the
   work twice.
2. **Every invoice carried the wrong GST split.** `company_state` was NULL, which
   defaulted all invoicing to intra-state, while all six seeded dealers are outside
   Haryana. 43 raised invoices hold ₹1,46,952.44 of tax on the wrong split.
3. **Production output could never ship for a batch-tracked product.** FEFO plans
   from `product_batches`, but production wrote `batch_id = null`, so approval
   approved against a `stock_levels` figure the batch allocator then refused.
4. **PRD §9.4 regional reporting was not actually delivered.** A view named
   `sales_by_region` existed and looked like the requirement met, but had no time
   axis and summed every order status into one column.

```
postgres now has 49 recorded migrations

live database
PASS  day2_rls_test.sql                       ( 14 run,  0 failed)
PASS  stage11_compliance_procurement_test.sql (160 run,  0 failed)
PASS  stage12_admin_delivery_test.sql         (133 run,  0 failed)
PASS  stage13_order_edit_test.sql             ( 70 run,  0 failed)
PASS  stage14_place_of_supply_test.sql        ( 26 run,  0 failed)
PASS  stage15_production_batches_test.sql     ( 27 run,  0 failed)
PASS  stage16_regional_reporting_test.sql     ( 41 run,  0 failed)
PASS  stage3_inventory_test.sql               ( 12 run,  0 failed)
PASS  stage4_production_qc_test.sql           ( 14 run,  0 failed)
PASS  stage5_order_dispatch_test.sql          ( 10 run,  0 failed)
PASS  stage8_payment_allocation_test.sql      ( 16 run,  0 failed)
11/11 test files passed (523 assertions)

fresh replay        all 41 fresh install checks passed
web                 eslint clean, next build 23 routes
ui:smoke            NOT RUN - blocked, see "What is not done"
ui:lifecycle        NOT RUN - blocked, see "What is not done"
```

---

## 1. Editing a pending order

`20260928094500_edit_dealer_order_line_storage.sql` adds
`public.edit_dealer_order(uuid, jsonb)`.

A pending order is editable by the dealer who raised it, the rep mapped to that
dealer, or an admin. It is **not** editable by a manager or a director, because
approval is a credit decision on a specific total, and letting a manager change the
figure that the credit check just cleared would make the check meaningless.

**Lines are replaced, not merged.** A request naming a product twice is one line
with the quantities summed, so a UI that double-submits cannot create a duplicate
line. An edit that adds a line removes the lines the request did not name; an
alternative, merging, would let a caller who omits a line silently keep it, and the
resulting order would not match what the request asked for.

**Price is re-read from the database, never taken from the request.** The request
carries `unit_price` because the catalogue has to send it, and the function ignores
it. This was the actual bug behind the work: `create_dealer_order` has always
priced against the order's own dealer, but `dealer_catalog` resolved price through
`private.current_dealer_id()` — null for a rep and for an admin — so a rep filling
in an order for a negotiated account was shown a total the database was never going
to charge. The proxy form even said so on screen: "The dealer's own price list is
applied when the order is accepted." It had already been applied.

Both entry points now route through one function, `private.dealer_unit_price`, so
no code path can return a price the pricing function would not produce.

Also: expired dealer prices are ignored, a refused edit leaves nothing behind, a
line cannot be raised past remaining stock, and clearing the requested delivery date
is accepted as a correction rather than rejected as "no change".

---

## 2. Place of supply, and 43 invoices that need attention

The supplying office is registered in **Haryana**. `company_state` was NULL, and
the invoice logic treated NULL as intra-state, so every invoice carried a CGST/SGST
split for a supply to another state.

`20260928095000_confirm_haryana_place_of_supply.sql` records the state. It only
writes where the value is currently null or blank, so a later deliberate change to
the registered state is not silently reverted on re-run.

**No raised invoice was rewritten.** Moving tax between IGST and CGST/SGST on an
issued document is a compliance action, not a data fix, and it belongs with the
accountant. The migration adds `public.finance_place_of_supply_review`, a
security-invoker view listing the 43 affected invoices and the ₹1,46,952.44 of tax
on the wrong split, so the credit-note-and-reissue work is queued and visible
rather than forgotten. **This is the single most important thing in this report and
it is not done.**

`stage14` builds both branches from the same order by moving the dealer between
Haryana and Maharashtra, so the only variable is the state. A rule that has only
ever been exercised one way is a rule that quietly rots, and the seed has no Haryana
dealer, so the intra-state branch would otherwise never be tested.

---

## 3. Production output and shippable stock

For a product with any batch, FEFO allocation plans only from `product_batches`.
Production wrote its stock movement with `batch_id = null`. So a passed QC run on a
perishable product raised `stock_levels` — which is what approval read — and the
order approved cleanly, then failed at the loading bay when the batch allocator
found nothing to allocate from. The order was approved against stock the system
could not actually ship.

`20260928095500_production_batches.sql`:

- adds `products.shelf_life_days`, nullable, `1..3650`;
- a passed production run creates a batch, `PRP-YYYYMMDD-XXXXXXXX`, manufacture
  date from the run date, expiry from the shelf life;
- the stock movement is linked to that batch;
- approval now checks unexpired batch stock, so the failure reaches the sales
  manager at approval time rather than the loading bay.

Two refusals are deliberate. A run whose batch would already be expired is refused
rather than creating a batch born dead, and a product that already has batches but
no shelf life set is refused, because silently creating an unexpirable batch would
reintroduce the original bug in a new place.

**Every seeded product still has `shelf_life_days = NULL`.** How long QSA feed keeps
is a product-master fact, and guessing it would invent data that then drives expiry
and FEFO for real stock. Until it is set, production output for those products
stays unbatched and the existing behaviour holds. This needs the product master,
not a migration default.

---

## 4. Regional reporting

`20260928100000_regional_sales_reporting.sql` replaces the appearance of §9.4 with
the thing itself. The view it replaces, `sales_by_region`, had no time axis, so
every figure was "all of history", and it summed orders of every status into one
`order_value` column — which is neither revenue nor credit exposure, and looks
authoritative while being neither.

Four views, all `security_invoker`:

| View | Grain |
| --- | --- |
| `sales_by_region_period` | region × calendar month |
| `sales_by_region_period_totals` | region, all time |
| `sales_by_rep` | rep × region, rolled up one level to the manager |
| `sales_by_dealer` | dealer, including dealers with no orders |

**Realized and pipeline are separate measures everywhere.** Realized is approved,
dispatched, or invoiced. Pipeline is pending or pending-director, which is also
exactly what credit approval checks. They are never summed. Rejected value is
reported on its own so approval quality is visible.

The rep rollup goes up exactly **one** level. PRD §3.1 is rep → manager → director,
and a transitive walk would label every manager as the director, making the column
useless while still looking populated. `stage16` asserts both directions: every
`manager_id` matches the rep's own direct manager, and the seed contains a
rep → manager → manager chain so a transitive walk would actually be visible.

Visibility is enforced in the database, not by filtering in the page, so the screen
cannot leak by forgetting a clause. `stage16` asserts a rep sees zero rows for
another rep's dealer, that their pipeline total covers only dealers they may see,
and that `qc_staff` sees no dealer book and no regional figures at all — a
reporting surface a non-commercial role can read is the failure mode worth naming.

### Two bugs the new tests found

`stage16` caught a false claim in my own code. `private.region_of` was defined with
`nullif(x, '')`, which does not catch a whitespace-only value, so a region of
`'   '` — which a text input produces when someone types spaces and submits — would
have become a region literally named with three spaces, separate from the state it
was meant to fall back to. The function's comment claimed whitespace was handled.
`20260928100500_region_of_trims_whitespace.sql` corrects it with `btrim`.

That correction is a separate migration rather than an edit to `20260928100000`,
because that file was already applied to the target database. Editing it would make
a fresh replay build a different schema from the one running, which is the exact
drift the append-only rule exists to prevent.

The same suite also failed 20 assertions on its first run because the whole suite
ran as the database owner, with no JWT claim set. `private.can_view_dealer` reads
`auth.uid()` and returns false for anyone who is not an active internal user, so
every view returned zero rows — and all 20 assertions passed or failed against an
empty report. The suite now impersonates the admin for its main body. Worth noting
because it is a quiet failure mode: a view whose RLS is correct looks broken to a
test that forgets to set a session.

---

## 5. Charts

`web/src/components/charts.tsx` has three components, all server-side SVG: a
grouped period trend, a ranked bar list, and a two-way split bar.

No charting dependency. Every number arrives already aggregated by a view, so there
is no dataset to fit or scale interactively, and the components reuse the app's
existing colour tokens (`#dfe6dc`, `#6f8c3b`, `#819083`) so they cannot drift from
the rest of the UI. Staying server components also keeps a client chart library out
of the bundle.

Two details that are easy to get wrong and are commented in the file: the y-axis is
rounded up to a 1/2/5 × 10ⁿ step, because a bar touching the frame reads as clipped
and a non-round axis makes bars incomparable at a glance; and the period axis is
backfilled across months with no orders, because the view is month-bucketed and an
absent month would otherwise visually compress a real gap in trading.

---

## What is not done, and why

These are stated rather than omitted, because a report that lists only successes is
not a report.

**Browser tests have not been run since the order-edit and reporting work.** Both
`ui:smoke` and `ui:lifecycle` require the shared demo password, which was invalid
on the last attempt. The reporting screen is covered by a build and by 41 database
assertions, but the route-level access control in `ui-smoke` — now updated to
include `/sales/reports` for five roles and refuse it for the other five — has not
been executed. The lifecycle test's new edit-and-close flow is likewise unverified.
This is the largest gap in this milestone.

**The 43 invoices still need a credit note and reissue.** Queued, not fixed.

**`shelf_life_days` is unset on every product.** A product-master decision.

**Tally is parked by agreement** until the API is available at final integration.
The database side is complete and tested.

**Not deployed.** Intended for Vercel, with a Git push and component testing to
follow. The app has only ever run against the development database.
