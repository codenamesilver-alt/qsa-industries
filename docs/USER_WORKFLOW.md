# QSA Industries ERP — User Workflow Guide

This guide explains how work actually moves through the system: who does what, which
screen each action lives on, and what the system will and will not let you do.

It is written for the people who use the portals day to day. It is not a technical
document. If you need to know how a screen is built, ask an administrator.

---

## 1. Signing in

Open the site root. You land on a workspace chooser with three portals:

| Portal | Who signs in here | What it covers |
| --- | --- | --- |
| **Internal operations** | admin, production manager, inventory manager, QC staff, logistics, finance | Production, quality, stock, purchasing, dispatch, delivery, invoicing, master data |
| **Sales management** | sales rep, sales manager, sales director | Territory coverage, dealer accounts, order approvals, reporting |
| **Dealer portal** | dealer | Own account standing, catalogue, orders, delivery status |

Choose your portal and sign in with your email address and password. You are sent
straight to your portal's home screen. Accounts are created by QSA administration;
you cannot register yourself.

Two things to know about access:

- **Your role decides your menus.** A sales rep has no finance screens. A dealer has
  no purchasing screens. The navigation only shows what your role can use.
- **Your role also decides your data.** You see your own accounts, not the whole
  company's. See section 3.

If you open a screen your role cannot use, you get an access notice rather than an
empty page. Use **Sign out** in the top right when you are finished, especially on a
shared machine.

---

## 2. Roles and what each one owns

| Role | Owns | Main screens |
| --- | --- | --- |
| **Admin** | Everything, plus master data and user accounts | All internal screens, Administration, Dealer onboarding, and the organization chart editor |
| **Production manager** | Production runs and output | Internal overview, Production, Organization |
| **Inventory manager** | Stock, batches, suppliers | Internal overview, Inventory, Purchasing, Organization |
| **QC staff** | Quality verdicts on production runs | Internal overview, Quality, Organization |
| **Logistics** | Dispatch and delivery proof | Internal overview, Dispatch queue, Delivery board, Organization |
| **Finance** | Invoicing, receipts, credit, ageing | Internal overview, Finance, Organization |
| **Sales rep** | Mapped dealer accounts, orders, edits | Sales overview, Sales orders, My reporting |
| **Sales manager** | Team approvals and dealer coverage | Sales overview, Approvals, Team, Team reporting |
| **Sales director** | Escalations and full reporting line | Sales overview, Director queue, Oversight |
| **Dealer** | Own account only | Overview, Catalog, My orders |

An admin can act in any of these capacities. Where a screen says "admin or …", the
admin is a valid substitute for the named role, never an extra privilege on top of it.

---

## 3. How much of the business you can see

Sales data is scoped by reporting line, not by luck.

- A **sales rep** sees the dealer accounts mapped to them. Nobody else's.
- A **sales manager** sees every dealer held by the reps who report to them.
- A **sales director** sees the whole sales organisation.
- An **admin** sees everything.
- A **dealer** sees only their own account: their credit, their orders, their prices.

The system enforces this on the server, not just in the interface. A screen that is
missing a dealer is usually a mapping gap rather than a bug: a dealer with no mapped
sales rep appears to nobody, and nobody can order on their behalf until an admin or a
manager maps one. Managers reassign dealers on the **Team** screen, but only to reps
on their own team. Moving a dealer between managers, or leaving a dealer unassigned,
is an admin action.

Internal roles see operational data broadly: production, stock, orders in flight,
delivery. Finance and credit figures are shown in the finance and dealer views, not
on every internal screen.

All six internal roles can read the **organization chart**, and none of the sales or
dealer logins can. It is the one screen every internal person is given, because a
warehouse clerk and a finance manager work out of the same shape of the company, and
neither of them should have to ask to see it.

---

## 4. The order lifecycle

This is the spine of the system. Order status moves like this:

```
Pending ──approve / override──► Approved ──mark dispatched──► Dispatched ──generate invoice──► Invoiced
   │
   └──escalate──► Pending director approval ──director approve──► Approved
                          │
                          └──director reject──► Rejected
```

Delivery status runs on its own track alongside it:

```
Awaiting dispatch ──mark dispatched──► In transit ──confirm delivery──► Delivered
```

An order reaches **Invoiced** when finance raises the invoice, which can happen while
the goods are still in transit. The two tracks are deliberately separate, so an
invoice does not pretend a delivery happened, and a delivery does not wait on finance.

Note the asymmetry: only an escalated order can be **Rejected**, and only by the
director. A pending order is either approved, overridden, or escalated.

### Step 1 — Dealer places the order

**Screen:** Dealer portal → Catalog
**Who:** the dealer

Open the catalogue to see live stock and your own price for each product. Enter a
quantity against the products you want, check the order total, then **Submit order**.

The order arrives as **Pending**. Nothing is reserved and nothing moves yet.

- Only products that are available for ordering appear as orderable.
- A dealer can only order for their own account.
- There is no delivery date at this stage. You set it when you edit the order, if the
  order needs one.

### Step 2 — Dealer corrects the order (optional)

**Screen:** Dealer portal → My orders
**Who:** the dealer

A **Pending** order can still be edited. Press **Edit this order**, change quantities,
remove lines, set a requested delivery date, then **Save changes**. Prices are
re-read from the catalogue and your price list, and stock is re-checked.

Editing replaces the whole order rather than one line, so check the totals before you
save. If the order carries a product that is no longer sellable, the edit is blocked
and the order has to be rejected and re-entered.

Once the order leaves Pending it is locked. There is no edit after approval, by design:
an approval is a credit decision taken on a specific total.

### Step 2a — Rep or admin raises the order for the dealer

**Screen:** Sales management → Approvals → Proxy order
**Who:** sales rep, admin

If a dealer orders by phone, the rep raises it for them. A rep may only name a dealer
mapped to them. An admin may name any active dealer, for data repair.

### Step 3 — Approve, override, or escalate

**Screen:** Sales management → Approvals
**Who:** sales manager, sales director, admin

Each order shows its lines, its total, and the dealer's credit position
(exposure of limit, with available headroom). Decide one of three ways:

- **Approve** — use this when the order is within the dealer's credit and stock is
  available. Status becomes **Approved**.
- **Override with remark** — use when the order is justified but exceeds the credit
  limit. A remark is mandatory. The approved order carries a **Credit override** badge
  so the exception is visible later. Status becomes **Approved**.
- **Escalate** — use when the decision should sit above you. A remark is mandatory.
  Status becomes **Pending director approval**.

Approval is refused if:

- the dealer's account is not **Active**,
- approving the order would take stock below zero,
- the order would exceed available credit with no override,
- the order is not **Pending** (only pending orders can be approved or escalated).

A sales rep cannot approve, override, or escalate. A rep's job is to get the order
right; approval is a manager or director act.

### Step 4 — Director decides escalations

**Screen:** Sales management → Approvals (the Director queue count)
**Who:** sales director, admin

Escalated orders appear in the director queue as **Pending director approval**.

- **Approve** — the order becomes **Approved** and joins the dispatch queue.
- **Reject** — the order becomes **Rejected**. A rejection remark is mandatory, because
  this is the answer the dealer will be given.

### Step 5 — Dispatch

**Screen:** Internal operations → Dispatch queue
**Who:** logistics, admin

The dispatch queue lists approved orders only. On each order, type an optional note
and press **Mark dispatched**.

What happens at this moment:

- Dispatch date is stamped as today.
- Stock is drawn down automatically.
- Batches are consumed **first expiry first out**, so old stock leaves before new.
- Delivery status becomes **In transit** and the order status becomes **Dispatched**.

If dispatch fails for insufficient stock, the approval was wrong about availability
or stock was consumed elsewhere. Fix the stock position or the order, then re-check
the queue.

### Step 6 — Confirm delivery

**Screen:** Internal operations → Delivery board
**Who:** logistics, admin

The delivery board shows what is ready to dispatch, what is in transit, and what has
been delivered. For each consignment in transit, press **Confirm delivery**. A delivery
note is optional in the system, but it is the only place facts like "2 of 12 cartons
short" can live, so record who signed, what was short or damaged, and where the goods
were left.

Delivery status becomes **Delivered**. The order status does not change here; invoicing
is a separate step.

### Step 7 — Generate the invoice

**Screen:** Internal operations → Finance → Invoice queue
**Who:** finance, admin

The invoice queue lists dispatched orders that have no invoice. Press
**Generate invoice**.

- Only **dispatched** orders can be invoiced.
- One invoice per order; an order cannot be invoiced twice.
- Invoice lines carry the product HSN code and GST rate from the product master, so the
  tax breakdown is correct without re-entry.
- Order status becomes **Invoiced**.

Invoice creation is manual and sequential. Work the queue top to bottom.

### Step 8 — Record payments

**Screen:** Internal operations → Finance
**Who:** finance, admin

Two kinds of receipt:

- **Against an invoice** — the Invoice register. Enter amount, payment mode, and a
  reference. Partial payments are fully supported; the invoice stays open until it is
  settled.
- **Advance to the account** — the Dealer account payments panel. Money received before
  an invoice exists. It sits as advance balance and is credited to the account.

Payment modes: bank transfer, cash, UPI, cheque, other.

A payment is refused if the amount is not positive, if it exceeds what is still owed on
that invoice once the dealer's advance balance is applied, or if the dealer on the
payment does not match the dealer on the invoice.

### Step 9 — Review the position

**Screen:** Finance → Dealer credit exposure, Invoice ageing
**Who:** finance, admin

- **Dealer credit exposure** shows open orders plus unpaid invoice balances per dealer.
- **Invoice ageing** buckets what is owed using the thresholds in finance settings.

**Finance settings** (Finance → Ageing and credit settings) control:

- **Grace period** — days before an invoice counts as overdue. Leave blank to treat
  every unpaid invoice as overdue immediately.
- **Ageing buckets** — three day thresholds, which must increase. For example 30 / 60 / 90.
  Leave one blank to stop counting that bucket. Anything past the last bucket is reported
  as an over-threshold remainder.
- **Count invoices that are not yet due** — on means invoices consume credit headroom
  from issue; off means only overdue invoices do.

---

## 5. Credit control in detail

Credit is the guardrail the whole sales process runs against. Understanding it prevents
most rejected actions.

**Exposure** is a dealer's open order value plus their unpaid invoice balances.
**Available credit** is the limit minus exposure. The limit in force is the dealer's
base credit limit, unless a per-dealer override has been set in **Dealer credit and
region** — an override replaces the base limit for that dealer, it is not added to it.
Leave the override blank to keep using the base limit.

When approving an order:

- If the order fits inside available credit, approve it normally.
- If it does not, the system refuses and asks for one of two things: an override with a
  remark, or an escalation.

Use the override for a considered commercial exception. Use escalation when the
decision is not yours to make. Both require a written remark, and both are visible on
the order afterwards.

A dealer whose account is **Inactive** or **Suspended** cannot order, cannot have
orders placed for them, and cannot be dispatched to.

---

## 6. Exception paths

### Order rejected at the director

Only the sales director (or an admin) can reject, and only on an escalated order. A
remark is required. The dealer sees the order as **Rejected** in My orders. To retry,
the dealer places a new order; a rejected order cannot be reopened.

### Order blocked by credit

Do not simply escalate everything. Check the dealer's exposure first. If the exposure
is caused by unpaid invoices, the fix is a payment, not an override.

### Order blocked by stock

Approval checks availability, but stock can move between approval and dispatch. If
dispatch fails for insufficient stock, either produce or receive stock, or have the
dealer reduce the order before it is dispatched.

### Dealer cannot order

Check, in this order:

1. Is the dealer account **Active**? Finance sets this on the dealer credit panel.
2. Is the dealer mapped to an active sales rep? An unmapped dealer blocks proxy orders
   and reporting visibility.
3. Does the dealer have credit headroom?

### Wrong order details after approval

Orders lock at approval. If the details are wrong, the order still has to run its
course; record the correction in the dispatch note or delivery note so the paper trail
carries it. Correct the master data behind the order (price, product) so the next order
is right.

---

## 7. Onboarding a new dealer

**Screen:** Internal operations → Administration → Dealer onboarding
**Who:** admin

A new dealer passes through a fixed sequence. The board shows each dealer as a card
with its current stage and exactly what is still outstanding.

| Stage | Meaning |
| --- | --- |
| Paper only | Record created, nothing decided yet |
| Awaiting credit decision | A limit has been requested, no decision recorded |
| Credit refused | Credit was refused; the record stays open to be decided again |
| Awaiting login | Credit approved, no portal login yet |
| Awaiting activation | Credit and login done, waiting to go live |
| Live | Dealer is active and trading |
| Deactivated since | Dealer was live and has since been switched off |
| Declined | Onboarding was declined; the record is closed |

The sequence:

1. **Start an onboarding.** Enter dealer name, sales region, email, GSTIN, PAN, and
   the credit limit being requested. GSTIN must be 15 characters in the format
   `22AAAAA0000A1Z5`; PAN must be 10 characters in the format `AAAAA0000A`.
2. **Record the credit decision.** Approve or refuse.
   - On approve, the requested limit becomes the dealer's limit at activation.
   - On refuse, a reason is mandatory. The record stays open so a different figure can
     be decided later.
3. **Map a sales rep.** Pick an active sales rep. This can be done at any point before
   activation, but it is required — nobody can order for an unmapped dealer.
4. **Provision the login.** Create the dealer's portal account with an email address and
   a password. The login must carry the dealer role.
5. **Activate the dealer.** The button stays disabled until all three preconditions are
   met, and the card tells you which one is outstanding:
   - credit approved,
   - login provisioned,
   - active sales rep mapped.
6. **Decline** (instead of the above) if the dealer should not be taken on. A reason is
   mandatory and the record closes for good.

After activation, the dealer can sign in to the dealer portal, see their credit
position, and place orders.

---

## 8. Master data and pricing

**Screen:** Internal operations → Administration
**Who:** admin

### Products

Create a product with SKU, name, category, unit of measure, HSN code, and reorder point.
HSN must be 4, 6, or 8 digits. Each product carries two flags:

- **Active** — the product exists in the catalogue at all.
- **Sellable to dealers** — the product can be ordered. Clearing this hides it from
  dealer catalogues and blocks new order lines without touching any history.

Both can be switched off and back on; neither erases past orders, stock movements, or
invoices.

### Dealers

Dealer master holds name, region, email, status, and the base credit limit. A dealer
account must be linked to a dealer record before it can trade. Status is one of
**Active**, **Inactive**, **Suspended**.

### Prices

A price belongs to **either** one dealer **or** one price tier, never both and never
neither. Set a start and end date; the end cannot fall before the start. A dealer or
tier cannot hold two prices for overlapping dates. Dealers see their own price; everyone
else sees the tier price.

### Users and reporting lines

**Screen:** Internal operations → Administration → Create a staff login, and Users,
roles and reporting lines

Creating a login needs a key that must never reach a browser, so it is done by an
edge function the screen posts to rather than by a button that writes to the
database directly. The screen takes the person's name, login email, role, and — for
the two sales roles — a reporting line, and it takes an initial password that the
administrator types in.

- The password is used to create the sign-in and is **not stored, emailed, or shown
  again**. Hand it over in person.
- An email that already has an account is **refused**, not reused. That account is
  edited on the list below the form instead.
- Dealer logins are not made here. They carry a credit decision and a sales rep, so
  they are created from **Dealer onboarding**.
- The screen below edits an account: full name, role, active flag, dealer link, and
  reporting line.

Reporting rules the system enforces:

- A sales rep must report to an **active** sales manager.
- A sales manager must report to the **active** sales director.
- The last active admin cannot be demoted or suspended, so the system can never be
  locked out of its own administration.

Suspending a login is not the same as leaving a seat empty. A suspended person keeps
their post on the organization chart, marked, because the post is still theirs.

### The organization chart

**Screen:** Internal operations → Organization
**Who:** every internal role can read it; only an admin can change it

The chart is a list of posts, not a list of permissions. A post is a box with a
title, an optional person, and one post above it. It answers "who works under whom",
which the role model does not answer, because a role says what somebody may do and
the chart says where they sit.

How it behaves:

- There is exactly **one top head**. Every other post hangs under something.
- A post title is free text, so "CEO", "Head of Production", and "Quality Lead" are
  all titles. A role is a separate thing and is not on the chart.
- A post can be **left vacant** while it is open. A vacant post is drawn as vacant,
  not as a person nobody can name.
- **One person may hold more than one post.** The chart shows them twice, and the
  editor warns you at the moment you choose, because the person drawing the chart
  can explain why and a reader cannot.
- A post can be moved under a different post, and a move is refused if it would put
  a post above its own reports.
- Deleting a post that still has posts below it is refused, one at a time. Only the
  whole chart can be deleted at once, and deleting a post never touches a login.

Sales and dealer logins are not on this screen. The chart describes the company, and
those accounts work in the sales and dealer portals.

### Finance credit and region

Finance maintains each dealer's credit limit override, region, and status from the
Finance screen. Leave the override blank to use the base limit from dealer master.

---

## 9. Purchasing and supplier receipts

**Screen:** Internal operations → Purchasing
**Who:** inventory manager, admin (production manager and finance can view the screen
but cannot raise or receive)

Buying is for raw materials only — you cannot raise a purchase order for a finished
product.

1. **Raise purchase order.** Enter supplier, expected date, and one or more lines with
   quantity and unit price. The expected date cannot be in the past. Press
   **Raise purchase order**.
2. **Receive against purchase order.** Enter the quantity actually received on each
   line. Receipts are partial by nature: a purchase order moves to **Partially received**
   as you receive, and to **Received** when every line is complete.
3. **Receive into batch.** Every receipt asks for a batch code, manufacture date, and
   expiry date. The expiry date is mandatory and cannot be in the past, and manufacture
   cannot be after expiry. The batch is created with the stock and enters the expiry
   queue.

Purchase order status: **Draft**, **Ordered**, **Partially received**, **Received**,
**Cancelled**.

---

## 10. Production and quality

### Record a production run

**Screen:** Internal operations → Production
**Who:** production manager, admin

Enter the run date, shift (morning, evening, night), finished product, output quantity,
and the raw materials consumed with their quantities.

Two rules worth knowing before you save:

- **Saving consumes raw materials.** The stock ledger is updated immediately.
- **A passed QC verdict also creates finished-goods stock in.** The output only becomes
  sellable stock once quality passes it.

Choose the initial QC status: pending, passed, or failed. **Failed requires notes** —
there is no way to record a failed run without saying why.

### Record a QC verdict

**Screen:** Internal operations → Quality
**Who:** QC staff, production manager, admin

The Quality queue lists every production run with no verdict yet. Select **Pending**,
**Passed**, or **Failed**, add notes (required on failure), and press **Record verdict**.

- **Passed** releases the output into sellable stock.
- **Failed** holds it back, with your notes as the record of why.

A finalized verdict cannot be changed once it leaves pending. Who may set a verdict:
QC staff and an admin on any run; a production manager only on runs they recorded
themselves.

---

## 11. Inventory, batches, and adjustments

**Screen:** Internal operations → Inventory
**Who:** inventory manager, production manager, admin

The **Stock ledger** shows live quantity, reorder point, and replenishment state per
product. Anything at or below its reorder point is flagged as low stock, and the
dashboard counts the alerts for you.

### Record an adjustment

Use this for corrections: damage, loss, a recount, a found item. Choose **Stock in** or
**Stock out**, enter the quantity and a reason. Every adjustment writes a movement
record — nothing changes silently.

### Batches and expiry

The **Batch and expiry queue** shows every open batch with stock left, sorted so the
soonest expiry is visible first. Dispatch draws down batches first expiry first out, so
the queue is your early warning for stock at risk.

### Receive into batch

Stock arrives into a named batch from four sources: **Production output**, **Purchase
receipt**, **Stock adjustment**, and **Opening balance**. Each receipt carries a batch
code, manufacture date, and expiry date.

---

## 12. Dispatch and delivery

**Screen:** Internal operations → Dispatch queue, then Delivery board
**Who:** logistics, admin

- **Dispatch queue** — approved orders waiting to go. **Mark dispatched** with an
  optional note.
- **Delivery board** — three columns: ready to dispatch, awaiting delivery confirmation,
  and delivered. **Confirm delivery**, with a delivery note recording who signed and any
  shortage or damage.

Delivery status: **Awaiting dispatch**, **In transit**, **Delivered**.

---

## 13. Reporting

**Screen:** Sales management → My reporting / Team reporting / Oversight
**Who:** sales rep, sales manager, sales director, admin

Reports show realized revenue (invoiced), pipeline (open demand), outstanding, and
territory and rep breakdowns, all scoped to what your role can see.

The range controls at the top of the report apply to everything below them:

- **From** and **To** — order date in Asia/Kolkata, both ends included. Leave either
  box blank for an open-ended range.
- **Apply range** — redraw the report for that window.
- **All time** — clear the range.
- **Download Excel** — download exactly what is on screen, same range, same numbers.
- **Print / PDF** — print the visible report. The range controls themselves are not
  printed; the data is.

The sales overview adds the working pictures: pipeline health by status, open exposure
by dealer (ranked, so the credit risk is at the top), orders by lifecycle stage, and
your recent activity.

---

## 14. Status glossary

**Order status**

| Status | Meaning |
| --- | --- |
| Pending | Submitted, waiting for a sales decision |
| Approved | Credit decision made, waiting for dispatch |
| Pending director approval | Escalated, waiting for the director |
| Dispatched | Stock has left the premises |
| Invoiced | Invoice raised |
| Rejected | Declined with a recorded reason |

**Delivery status**

| Status | Meaning |
| --- | --- |
| Awaiting dispatch | Order approved, not yet on a vehicle |
| In transit | Dispatched, receipt not yet confirmed |
| Delivered | Receipt confirmed by logistics, with an optional note |

**Dealer account status**

| Status | Meaning |
| --- | --- |
| Active | Can order, can be dispatched to |
| Inactive | Temporarily switched off |
| Suspended | On hold |

**Purchase order status**

| Status | Meaning |
| --- | --- |
| Draft | Being prepared |
| Ordered | Placed with the supplier |
| Partially received | Some lines have arrived |
| Received | Every line complete |
| Cancelled | Stopped |

**QC status**

| Status | Meaning |
| --- | --- |
| Pending | No verdict yet |
| Passed | Output released to sellable stock |
| Failed | Output held back, notes recorded |

**Onboarding stage**

Paper only, Awaiting credit decision, Credit refused, Awaiting login, Awaiting
activation, Live, Deactivated since, Declined.

---

## 15. Common messages and what they mean

| Message | What happened | What to do |
| --- | --- | --- |
| Credit limit exceeded; use an override with a remark or escalate | The order is larger than the dealer's headroom | Override with a written reason, or escalate to the director |
| A remark is required for a credit override | You pressed override with an empty remark | Type the reason in the remark box and press again |
| An escalation remark is required | You escalated with an empty remark | Add the reason and escalate again |
| A rejection remark is required | You rejected with an empty remark | Add the reason; the dealer will be told this |
| Insufficient stock for product X while approving order Y | Approval would take stock below zero | Receive or produce stock, or have the order reduced |
| Dealer account is not active | The dealer is inactive or suspended | Finance reactivates the dealer on the credit panel |
| Dealer has no mapped sales representative | Nobody owns the account | An admin or the manager maps a rep on the Team screen |
| You cannot approve orders for this dealer | The order is outside your reporting line | Escalate, or ask the owning manager |
| Only sales directors can approve escalated orders | A manager tried to clear the director queue | Leave it for the director |
| Only logistics can dispatch orders | A non-logistics role tried to dispatch | Logistics or an admin dispatches |
| Only finance can generate invoices | Another role tried to invoice | Finance raises the invoice |
| Only dispatched orders can be invoiced | The order is approved but not yet dispatched | Dispatch first, then invoice |
| Order already has an invoice | Double invoicing attempt | Check the Invoice register; no second invoice is allowed |
| Payment exceeds outstanding invoice and advance balance | The receipt is larger than what is owed | Correct the amount, or split the receipt |
| Requested delivery date cannot be in the past | A date before today was entered | Pick today or a future date |
| Only a pending order can be edited | The order is already approved or beyond | Changes are no longer possible; raise a new order if needed |
| Failed QC requires notes | You tried to fail a run or verdict with no reason | Add the notes; a failure is never recorded without them |
| A price must belong to either one dealer or one tier | A price was saved with both or neither | Pick exactly one: a dealer, or a tier |
| That product already has a price for this dealer or tier over those dates | Overlapping price | Adjust the dates so they do not overlap |
| GSTIN must be 15 characters in the format 22AAAAA0000A1Z5 | Malformed GSTIN | Re-enter as 15 characters in that pattern |
| A sales rep must report to a sales manager | Reporting line incomplete | Assign an active sales manager as the rep's manager |
| The last active admin cannot be demoted or suspended | You would lock out the last administrator | Promote another admin first |
| A user with that email already exists | The address already has a sign-in | Edit that account on the list below the create form; the screen will not adopt it |
| Dealer logins cannot be created here | A dealer sign-in needs a credit decision and a sales rep | Create it from Dealer onboarding |
| The chart already has a top head | You tried to add a second one | Add your post below the existing top head instead |
| This position still has positions below it | Deleting a post that other posts report to | Move or delete the posts below it first, then delete this one |
| Only the whole chart can be deleted at once | Cascade delete on a post that is not the top head | Delete the posts below it one at a time, then this one |
| That would put the post above its own reports | A move into the post's own subtree | Pick a parent that is not below it |
| A position can only be held by a staff login | You picked a dealer account | Pick a staff account; dealer logins are not on the chart |
| Your session has expired. Sign in again | Session timed out mid-action | Sign in, then repeat the action |

---

## 16. Daily checklists

**Dealer**
1. Check available credit on the Overview.
2. Place or track orders in Catalog and My orders.
3. Note any invoice still open in your account standing.

**Sales rep**
1. Check the sales overview for pending orders and escalations on your accounts.
2. Correct any pending order details that were entered by phone.
3. Raise proxy orders for dealers who called in.
4. Check exposure by dealer for anything trending to its limit.

**Sales manager**
1. Clear the manager queue: approve, override with a reason, or escalate.
2. Check the Team screen for unassigned or wrongly held dealers.
3. Skim pipeline health and credit watch.

**Sales director**
1. Clear the director queue of escalations.
2. Review oversight reporting across regions and reps.

**Logistics**
1. Work the dispatch queue; mark orders dispatched.
2. Confirm deliveries in transit on the delivery board, with notes.

**Inventory manager**
1. Check low stock and reorder points.
2. Review the batch and expiry queue for stock at risk.
3. Raise purchase orders for what production will need.
4. Receive supplier stock into batches.

**Production manager**
1. Check raw material availability before recording runs.
2. Record production runs and monitor yield.
3. Follow up on pending QC verdicts blocking sellable stock.

**QC staff**
1. Clear the Quality queue.
2. Record verdicts, with notes on any failure.

**Finance**
1. Generate invoices for dispatched orders in the invoice queue.
2. Record payments and advances.
3. Review dealer credit exposure and invoice ageing.
4. Keep finance settings current.

**Admin**
1. Work the dealer onboarding queue to Live or Declined.
2. Keep products, prices, and users current.
3. Check that every active dealer has an active mapped sales rep.
