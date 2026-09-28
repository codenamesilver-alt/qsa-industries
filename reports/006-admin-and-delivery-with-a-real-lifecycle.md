# Report 006 of 009 — Admin Master Data, Consignment Delivery, and a Real 13-Flow Lifecycle

| Field | Value |
| --- | --- |
| Report | 006 of 009 |
| Date | 28 September 2026 |
| Milestone | Three migrations, the `/internal/admin` and `/internal/delivery` screens, a 133-assertion access-control suite, and a lifecycle test that now runs all thirteen of its flows |
| Status | **Complete** |
| Previous report | `005-grants-backup-proof-and-ui.md` |
| Next report | `007-*.md` (not yet written) |

> To resume: pick the highest-numbered report in `reports/`. Reports are
> append-only and never renumbered.

---

## Milestone outcome

Report 005 closed with a claim that the lifecycle test drives eleven flows. It did
not. Two of them, the sales rep's proxy order and finance's credit-limit edit,
sat inside a block that was spliced into the script wrong and never executed. The
script reported eleven and proved nine. This report re-runs the whole thing and
corrects the number.

```
postgres now has 41 recorded migrations

live database
PASS  day2_rls_test.sql                       ( 14 run,  0 failed)
PASS  stage11_compliance_procurement_test.sql (157 run,  0 failed)
PASS  stage12_admin_delivery_test.sql         (133 run,  0 failed)
PASS  stage3_inventory_test.sql               ( 12 run,  0 failed)
PASS  stage4_production_qc_test.sql           ( 14 run,  0 failed)
PASS  stage5_order_dispatch_test.sql          (  9 run,  0 failed)
PASS  stage8_payment_allocation_test.sql      ( 16 run,  0 failed)
7/7 test files passed (355 assertions)

fresh replay        all 41 fresh install checks passed
web                 eslint clean, tsc --noEmit clean, next build 22 routes
ui:smoke            10 roles, 25 allowed route visits, every other route refused and told why
ui:lifecycle        13 flows, order 8282db62 paid in full and its delivery confirmed
```

The lifecycle run's own closing line, unchanged in shape from report 005:

```
lifecycle passed: order 8282db62 -> QSA-2026-000113 paid in full
  plus: qc verdict, finance settings, purchase order, batch receive
  plus: proxy order by a sales rep, dealer credit edit by finance
```

---

## The false claim in report 005

The two dead steps were inside a block opened for flow 10 and closed after flow
11, and the `//` line that ended flow 10 had swallowed the opening brace of the
flow 11 block. What the file actually contained was a step 10 body, then a step 11
label with no body, then the closing brace for step 10. JavaScript parsed it
happily. The script printed `9.` for the last flow it ran and the report recorded
`11 flows`.

The number was never measured, only counted from the comments. It took until flow
10 was reached in a real run to see the missing work. Flow 10, the sales rep's
proxy order, also turned out to be the step that had to be repaired first: it
asserted against a column that does not exist.

## The `order_reference` column that never existed

Flow 10 located the order it had just created with

```sql
select id, order_reference from public.orders where dealer_id = $1
```

`orders` has no `order_reference` column. The order number a user sees,
`QSA-2026-000113`, is a sequence value the invoice carries, not the order. The
order is referenced by its uuid everywhere, and the eight-character prefix shown
on screen is `left(orders.id::text, 8)`. The query now selects `left(o.id::text, 8)
as reference` and the assertion matches that.

The delivery board was built on the same prefix, so the two now agree.

## `eq` between two uuids compares nothing

The proxy-order check passed while printing `= NaN`:

```
the order is on the dealer the rep named = NaN
```

`eq` coerces both sides with `Number()`. A uuid is not a number, so both sides
became `NaN`, and `Object.is(NaN, NaN)` is `true`, so the check passed. It had
never asked whether the order was on the dealer the rep named. The assertion now
uses `same`, which compares strings, and a check with `eq` on either side of a
uuid has been replaced throughout the file.

This is the same class of error report 005 recorded twice already: a test that
passes for a reason other than the one it claims to check. `NaN` printed into the
output was the only clue, and the output was being read as a log line rather than
as an assertion result.

## The credit-limit step was editing the wrong dealer

Flow 11 raised a dealer's limit to 50000 through the browser and restored it
afterwards. It reported:

```
credit limit as typed expected 50000, got 0
credit limit restored = 0
```

Both halves of that were wrong. The form the script filled belonged to Coastal
Agri Enterprises; the dealer it had selected was Legacy Agro Supplies. The
scoping locator walked two levels up from the dealer name field, and two levels
up from that field is the whole form stack, so the first dealer form on the page
matched any dealer name. The write went to Coastal, the read came from Legacy, and
the restore wrote Coastal's pre-step value over Coastal, so the step appeared to
put everything back while having actually changed nothing that mattered and having
then zeroed Coastal's limit on top of it.

Coastal's limit is now back at its seeded `300000.00`, confirmed by direct read.

The locator walks one level up, and the form is matched on its own dealer name
rather than on a name found anywhere above it. The run now shows the write landing
on the dealer the step selected:

```
dealer credit    Legacy Agro Supplies limit set to 50000 via the browser
dealer credit    credit limit as typed = 50000
dealer credit    credit limit restored = 0
dealer credit restore   Legacy Agro Supplies limit back at 0
```

## The admin and delivery migrations

Three files, applied to the live database and replayed on a scratch database.

### `20260927093000_admin_master_data.sql`

Products, dealers, users and prices had no browser write path. The existing
grants let a signed-in user read them and nothing else, so admin writes go through
`SECURITY DEFINER` functions that each check the caller's role, the same pattern
the purchasing and quality migrations used:

- `create_product`, `update_product`
- `create_dealer`, `update_dealer`
- `update_user_access` — role, suspension, dealer link, reporting line
- `set_dealer_price`

Each function raises unless the caller is `admin`, and `set_dealer_price`
additionally checks the dealer exists and the price is positive. No new grant on
any master table was needed, and none was taken: `authenticated` still holds
`SELECT` only on these tables, so the functions are the whole of the write path.

`user_directory` is a view over `public.users` and `public.auth.users` that
returns the columns the admin screen needs — including the email, which
`public.users` does not carry — for the admin role only.

### `20260927093100_delivery_status.sql`

Consignment state is a separate axis from order state. `dispatch_order` sets
`delivery_status = 'in_transit'` and `dispatch_date` alongside the existing
`status = 'dispatched'`, and a new `mark_order_delivered` records the
confirmation.

The split exists because the two answer different questions. An order can be
invoiced and paid while the goods are still on the road, and collapsing the two
into one status would force one of those facts to be wrong. `mark_order_delivered`
is the deliberate exception that documents itself: it writes
`delivery_status = 'delivered'`, `delivered_at` and the free-text note, and
returns without touching `public.order_status`. The lifecycle run asserts the
order is still `invoiced` after its delivery is confirmed.

The function is gated on `admin` or `logistics` and refuses any order whose
`delivery_status` is not `in_transit`.

### `20260927093200_delivery_board_dealer_name.sql`

The delivery board needs the dealer's name for every consignment. `logistics` is
not in `can_view_dealer`, so the board is a `SECURITY DEFINER` view that reads
`dealers` on the caller's behalf and returns a `security_barrier` result.

This is the narrow way round the problem. The alternative, adding `logistics` to
`can_view_dealer`, would have given logistics visibility of every dealer row in
the database to satisfy a board that shows one name per order.

## The two new screens

`/internal/admin` and `/internal/delivery`, both reachable from the internal
portal nav. Route gates mirror the functions: admin alone for `/internal/admin`,
`admin` and `logistics` for `/internal/delivery`.

The admin screen carries four forms over three tables: create and update a
product, create and update a dealer, update a user's access, and set a dealer
price. It reads through a service-role-free path, so everything on it is
`authenticated` RLS under a `SECURITY DEFINER` function.

The delivery screen lists consignments in transit, takes a confirmation with a
short note, and shows the days on the road.

## What the access-control suite checks

`supabase/tests/stage12_admin_delivery_test.sql`, 133 assertions, all on
`authenticated` and never on the owner role.

Every write function is called as a signed-in user and asserted to be refused for
each of the nine roles that is not `admin`, so a missing role check cannot pass
as "no rows changed". Each is then called as `admin` and asserted to write. The
role check and the state check are asserted separately, because a caller who is
refused for having the wrong role must not be able to learn anything about the
state of the row they were refused on.

Dealer visibility is asserted on the dealer login rather than on a hard-coded
dealer id. The seed creates exactly one dealer account, and the suite reads its
`dealer_id` out of `public.users`, so if the seed ever changes the dealer the
assertions follow it instead of passing vacuously.

## The lifecycle test now runs thirteen flows

The last two are new:

- **12. Admin prices a product and the price list records it.** A product is
  created through the admin screen at 431.25 with an HSN code, then a dealer price
  of 412.00 is set against it, and both writes are read back from
  `public.products` and `public.price_lists`.
- **13. Logistics confirms the delivery of the dispatched order.** The
  consignment from step 3 is confirmed through the delivery screen with a note, and
  the note, the timestamp, the new `delivery_status` and the untouched
  `public.order_status` are read back.

Flow 12 removes the product and its price when it is done. Left behind they would
grow the catalogue and the price list on every run, and the new product would
appear in the dealer catalogue the smoke test walks. The order the lifecycle is
about is untouched, and no order references the test SKU, so the delete cannot
reach a document line.

Flow 13 also attempts a second confirmation and asserts it is refused and that the
first note survives unchanged.

## The smoke test now proves the two new routes for every role

`/internal/admin` is allowed for `admin` alone and `/internal/delivery` for
`admin` and `logistics`. All other eight roles are asserted refused at both, and
the refusal is asserted three ways: it lands on `/unauthorized`, it says the route
is outside the role, and it offers a way back.

The three sales roles are listed by their leaf paths, not only through
`/internal`. A gate on the parent layout would refuse a sales user today, but
only the leaf routes prove the gate on each page.

Reviewing the matrix against the code found one route asserted nowhere: `/sales/orders`
permits `admin` in its `requireProfile` list and the admin nav links to it, yet
the smoke script had it in no role's allowed or denied list. It is now an allowed
route for `admin`, and `/internal/admin` is asserted refused for the other nine.

Content assertions on both screens are markers of correctly scoped data — the
admin screen must render a create-product form, a price list and the user list,
and the delivery board must render at least one consignment. A page that rendered
an empty shell with the right heading would still fail.

## Two numbers in report 005 were wrong

Report 005's summary block said `next build 22 routes`. The build at that commit
printed 20. It also said `11 flows` for a script that executed 9. Both figures
were carried over from a count of what existed rather than from the output of
running it, which is the same root cause as the dead flow block: nothing in the
pipeline was reading the result and comparing it against the claim.

This milestone counts both from the output. 22 routes, 13 flows, 10 roles.

## What this milestone does not prove

- **Still no Tally round trip.** The exporter writes and checksums CSV. No file
  has been imported into Tally, so the seven open mapping questions from report
  005 are untouched.
- **Still no deployment.** The PM2, Nginx and deploy assets have never run outside
  this machine.
- **The delivery board shows a state machine, not a carrier.** There is no
  consignment number, no carrier, and no tracking integration. The note is
  free text typed by a person.
- **A confirmed delivery is not a proof of receipt.** The screen records that
  someone typed a confirmation. It does not collect a signature, a recipient
  name, or a photo, and it cannot detect a short delivery even though the demo
  note says one carton was short.
- **No partial delivery.** `mark_order_delivered` is all-or-nothing. A consignment
  that arrives with one carton missing can only be recorded as delivered, and
  there is no return or shortage flow.
- **`price_lists_select_scope` hides future-dated rows.** The admin screen is
  therefore blind to a price scheduled for next month, while the catalogue
  computes against it. This is inherited from the 20260926 schema and is a real
  gap in the admin view, not in the pricing rule.
- **The lifecycle test still mutates the development database** and cannot clean
  up after an invoiced order. It now also creates and deletes its own product
  fixture, which is tidy, but the accounting fact it leaves is still permanent.
- **Browser coverage is Chromium only, at one viewport.** No Firefox, no WebKit,
  no mobile width, and the browser suites are not in CI because they need live
  credentials and mutate data.
- **The happy path only.** No failed save, lost session, slow network, or two users
  acting on the same order at once.

## State at completion

| Measure | Value |
| --- | --- |
| Migration files | 41 |
| Applied to live | 41 of 41 |
| Fresh-install checks | 41 of 41 |
| pgTAP suites | 7 of 7 (355 assertions) |
| stage12 assertions | 133, new |
| Roles in `ui:smoke` | 10 of 10, over 24 routes |
| Flows in `ui:lifecycle` | 13 of 13, all executed |
| Web routes built | 22, up from 20 |
| Corrected | Report 005's "11 flows" claim, which was 9 executed, and its "22 routes" claim, which was 20 |
| Defects found and fixed | 2 in the test harness (dead flow block, `eq` on uuids), 1 in the app (dealer form scoping in the harness), 1 in the delivered data (Coastal's credit limit) |

## Notes carried forward

- **Count the flows you run, not the ones you numbered.** Two of report 005's
  eleven flows never executed, and nothing in the output said so. The output now
  ends with a per-flow summary, and flow 12 and 13 print their own numbered
  milestones.
- **`NaN` in a passing assertion is a bug, not decoration.** `eq` coerces with
  `Number()`, and `Object.is(NaN, NaN)` is `true`. Any comparison between two
  uuids through `eq` passes without comparing anything.
- **A locator that walks up too far matches every form on the page.** The
  credit-limit step scoped a dealer form two levels above the field and silently
  edited the first dealer instead of the one it named.
- **A test that mutates state must prove it restored it, not assume it.** The
  credit-limit step reported a clean restore while having zeroed a different
  dealer's limit. The read-back now names the dealer it edited.
- **Access-control tests stay on `authenticated`.** That is the pattern that
  caught all of this, and it has now produced every correct conclusion in this
  schema.

## Next milestone

Carried forward from reports 004 and 005, now the only things left:

- answer the seven Tally mapping questions and reconcile a real round trip
- provision a server and run `deploy.sh` as a rehearsal
- decide whether the demo accounts and shared password are replaced before any
  real traffic
- decide whether delivery needs partial receipt, a carrier, or a proof of
  delivery before this goes anywhere near a real customer
