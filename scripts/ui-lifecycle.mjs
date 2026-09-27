// End-to-end order lifecycle test against a running server.
//
//   npm run ui:lifecycle         (expects a server already listening on :3100)
//
// Drives the real UI across four logins, with no direct database writes:
//
//   dealer    /dealer/catalog    submit order
//   sales mgr /sales/orders      approve
//   logistics /internal/orders   mark dispatched
//   finance   /internal/finance  generate invoice, then pay it in full
//
// The browser performs every transition; the database is only read, to decide
// which panel to click and to verify the outcome. That split is deliberate: if
// the UI and the database disagree, the test must fail rather than pass on the
// strength of a write it made itself.
//
// This creates one real order, one invoice and one payment in the target
// project. It is safe against pgTAP because those suites are transaction-local
// and scoped to their own rows, but it does add a genuine end-to-end record.
//
// SMOKE_PASSWORD supplies the demo password. SMOKE_BASE_URL overrides the
// target. Screenshots land in .smoke-lifecycle/ on failure.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { connect } from "./lib/db.mjs";

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const PASSWORD = process.env.SMOKE_PASSWORD;
const SHOTS = process.env.SMOKE_SHOTS ?? path.join(process.cwd(), ".smoke-lifecycle");
const DEALER_ID = "20000000-0000-4000-8000-000000000003";
const SKU = "QSA-BROILER-01";
// Every run dispatches a real order, so the quantity is a permanent draw on the
// demo stock. A fixed large default drained QSA-BROILER-01 to nothing after a
// handful of runs and the next run failed on insufficient stock.
//
// The default is derived from the current order count rather than randomised: the
// sales screen picks its panel by matching this order's total, so two runs must
// never produce the same total, and a random pick collides within a handful of
// runs. Tying it to a value that changes every run keeps the totals distinct
// while the quantity stays small. E2E_QTY overrides it.
const QTY_OVERRIDE = Number(process.env.E2E_QTY) || null;
let QTY = QTY_OVERRIDE;
const NOTE = "E2E dispatch note";

// The proxy order is a small fixed quantity rather than the derived QTY: it is
// never approved or dispatched, so it draws no stock, and it must not collide
// with the main order's total on the sales screens.
const PROXY_QTY = 3;

// The app's own notion of the current business date, which the proxy form
// validates the requested delivery date against. Mirrors private.business_date():
// IST, since the business runs on local time.
function businessDate() {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}

if (!PASSWORD) {
  console.error("Set SMOKE_PASSWORD to the demo account password.");
  process.exit(2);
}

const ACCOUNTS = {
  dealer: { portal: "dealer", email: "dealer@qsa-demo.in", home: "/dealer" },
  sales: { portal: "sales", email: "meera.nair@qsa-demo.in", home: "/sales" },
  logistics: { portal: "internal", email: "logistics@qsa-demo.in", home: "/internal" },
  finance: { portal: "internal", email: "finance@qsa-demo.in", home: "/internal" },
  salesRep: { portal: "sales", email: "ravi.menon@qsa-demo.in", home: "/sales" },
  admin: { portal: "internal", email: "admin@qsa-demo.in", home: "/internal" },
  inventory: { portal: "internal", email: "operations.inventory@qsa-demo.in", home: "/internal" },
  qc: { portal: "internal", email: "qc@qsa-demo.in", home: "/internal" },
};

const problems = [];
const log = [];
let stepNo = 0;

function step(name, detail) {
  stepNo += 1;
  const line = `${String(stepNo).padStart(2)}. ${name.padEnd(30)} ${detail}`;
  console.log(line);
  log.push(line);
}

function fail(where, message) {
  problems.push(`${where}: ${message}`);
  console.log(`    !! ${where}: ${message}`);
}

function check(where, condition, message) {
  if (!condition) fail(where, message);
  return condition;
}

function eq(where, actual, expected, label) {
  const a = Number(actual);
  const e = Number(expected);
  if (!Object.is(a, e)) {
    fail(where, `${label} expected ${e}, got ${a}`);
    return false;
  }
  console.log(`       ${label} = ${a}`);
  return true;
}

function same(where, actual, expected, label) {
  if (actual !== expected) {
    fail(where, `${label} expected ${expected}, got ${actual}`);
    return false;
  }
  console.log(`       ${label} = ${actual}`);
  return true;
}

// en-IN grouping, matching web/src/lib/format.ts
// en-IN groups thousands, so a captured amount can arrive as "1,537.5".
// Number() on that string is NaN, which silently turned every grouped total into
// "cart shows NaN" in the log and would break any comparison built from it.
const inr = (value) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(String(value).replace(/,/g, "")));

// hasText matches substrings, so a Rs 5,137.50 total would also match a panel
// showing Rs 25,137.50. Anchor on the currency symbol and forbid a trailing digit
// or separator so only the intended panel matches.
function totalPattern(total) {
  const escaped = inr(total).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\u20B9${escaped}(?![\\d,.])`);
}

const db = connect();
await db.connect();
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

const IGNORE = [/favicon/i, /Download the React DevTools/i, /supabase.*rate limit/i];
const problemsFromBrowser = [];

function watch(page, where) {
  const sink = { console: [], pageerror: [] };
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORE.some((re) => re.test(text))) return;
    sink.console.push(`[console] ${text}`);
  });
  page.on("pageerror", (error) => sink.pageerror.push(error.message));
  return {
    drain() {
      for (const [kind, list] of Object.entries(sink)) {
        for (const item of list) problemsFromBrowser.push(`${where}: ${kind} ${item}`);
        list.length = 0;
      }
    },
  };
}

async function visit(page, url) {
  const started = Date.now();
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("main", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
  return { status: response ? response.status() : 0, ms: Date.now() - started };
}

async function login(context, who) {
  const account = ACCOUNTS[who];
  const page = await context.newPage();
  const seen = watch(page, who);
  await visit(page, `${BASE}/login/${account.portal}`);
  await page.fill("#email", account.email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  try {
    await page.waitForURL((url) => url.pathname === account.home, { timeout: 30000 });
  } catch {
    const message = (await page.locator("[aria-live=polite]").first().textContent().catch(() => "")) ?? "";
    throw new Error(`${who} login did not reach ${account.home}; form said: ${message.trim()}`);
  }
  return { page, seen };
}

// Wait for the DataPanel carrying this order's total to show `badge` as its
// status pill. The panel filter must include the badge: several panels can match
// the total, and taking .first() of a total-only filter can watch the wrong one
// while the real transition succeeds.
async function waitForBadge(page, total, badge, timeout = 30000) {
  const panel = page
    .locator("main section")
    .filter({ hasText: totalPattern(total) })
    .filter({ has: page.getByText(badge, { exact: true }) });
  try {
    await panel.first().waitFor({ timeout });
    return true;
  } catch {
    return false;
  }
}

fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: true });
const startedAt = new Date();

// ---------------------------------------------------------------- baseline ---
const baseline = await one(
  `select
     (select private.order_exposure($1))::numeric as exposure,
     (select available_quantity from public.dealer_catalog where sku = $2)::numeric as available,
     (select count(*)::int from public.orders) as orders,
     (select count(*)::int from public.invoices) as invoices,
     (select count(*)::int from public.payments) as payments`,
  [DEALER_ID, SKU],
);
step("baseline read", `exposure ${baseline.exposure}, ${SKU} available ${baseline.available}, ${baseline.orders} orders`);

if (QTY === null) QTY = 7 + (baseline.orders % 50);

// Dispatch removes stock permanently, so a run that cannot actually be fulfilled
// is a setup problem, not a product defect. Say so plainly instead of letting it
// surface as an unexplained "order not confirmed" several steps later.
if (Number(baseline.available) < QTY) {
  console.error(
    `Refusing to run: only ${baseline.available} of ${SKU} is available but the lifecycle needs ${QTY}. ` +
      "Each run dispatches a real order, so restore the demo stock before running again.",
  );
  await db.end();
  await browser.close();
  process.exit(2);
}

const collisions = await one(
  `select count(*)::int as n from public.orders o
   where o.dealer_id = $1
     and o.total_amount = (select unit_price from public.dealer_catalog where sku = $2) * $3`,
  [DEALER_ID, SKU, QTY],
);
if (collisions.n > 0) {
  console.error(
    `Refusing to run: ${collisions.n} existing Coastal order(s) already total this value, ` +
      `so the UI panel for the new order would be ambiguous. Re-run with a different E2E_QTY.`,
  );
  await db.end();
  await browser.close();
  process.exit(2);
}

let orderId = null;
let invoiceId = null;
let invoiceNumber = null;
let invoiceTotal = null;

// ------------------------------------------------- 1. dealer submits order ---
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const { page, seen } = await login(context, "dealer");
  const { status } = await visit(page, `${BASE}/dealer/catalog`);

  const row = page.locator("tr").filter({ hasText: SKU }).first();
  const rowText = (await row.innerText()).replace(/\s+/g, " ");
  const priceMatch = rowText.match(/\u20B9([\d,]+(?:\.\d+)?)/g);
  const unitPrice = Number(priceMatch[priceMatch.length - 1].replace(/[\u20B9,]/g, ""));
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    seen.drain();
    fail("dealer/catalog", `could not read a unit price from the ${SKU} row: ${rowText}`);
    await context.close();
// ------------------- 10. a sales rep places a proxy order for a mapped dealer ---
{
  // The rep's dealer list is a convenience in the UI, not the authority:
  // create_dealer_order re-checks that the rep is mapped to the dealer they
  // name. So the browser test picks a dealer the rep is actually mapped to,
  // rather than the first option, which is only mapped by luck of the sort order.
  const mapped = await db.query(
    `select d.id, d.name
       from dealers d
       join users u on u.id = d.sales_rep_id
      where u.email = $1
      order by d.name
      limit 1`,
    [ACCOUNTS.salesRep.email],
  );
  const target = mapped.rows[0];
  check("sales/orders", Boolean(target), "the sales rep is not mapped to any dealer, so proxy ordering is untestable");

  if (target) {
    const before = await one(`select count(*)::int as n from public.orders`);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    const { page, seen } = await login(context, "salesRep");
    await visit(page, `${BASE}/sales/orders`);

    const form = page.locator("main form").filter({ has: page.getByRole("button", { name: /submit proxy order/i }) });
    if ((await form.count()) === 0) {
      fail("sales/orders", "no proxy order form was rendered for a sales rep");
    } else {
      await form.getByLabel(/^dealer$/i).selectOption(target.id);

      // Same SKU as the main order so available stock is known to be sufficient,
      // but a much smaller quantity: this order is never approved, dispatched or
      // paid, it exists only to prove the write path.
      const row = form.locator("tr").filter({ hasText: SKU }).first();
      if ((await row.count()) === 0) {
        fail("sales/orders", `the proxy catalog did not offer ${SKU} to order`);
      } else {
        await row.getByLabel(/quantity/i).first().fill(String(PROXY_QTY));
        await form.getByLabel(/requested delivery date/i).fill(businessDate());
        await form.getByRole("button", { name: /submit proxy order/i }).click();
        const placed = await form
          .getByText(/order submitted/i)
          .waitFor({ timeout: 30000 })
          .then(() => true)
          .catch(() => false);
        step("proxy order", placed ? `placed for ${target.name} via the browser` : "no confirmation appeared");
        if (!placed) await page.screenshot({ path: path.join(SHOTS, "FAILED-10-proxy.png"), fullPage: true });
      }
    }
    seen.drain();
    await context.close();

    const created = await one(
      `select o.id, o.status, o.dealer_id, o.created_by,
              (select count(*)::int from public.order_items i where i.order_id = o.id) as lines
         from public.orders o
        where o.dealer_id = $1
        order by o.created_at desc
        limit 1`,
      [target.id],
    );
    check("sales/orders", Boolean(created), `no order was created for ${target.name}`);
    if (created) {
      const owner = await one(`select email from public.users where id = $1`, [created.created_by]);
      step("proxy order row", `status ${created.status}, created by ${owner ? owner.email : created.created_by}`);
      eq("sales/orders", created.dealer_id, target.id, "the order is on the dealer the rep named");
      same("sales/orders", owner?.email, ACCOUNTS.salesRep.email, "the order was placed by the sales rep account");
      eq("sales/orders", created.lines, 1, "order line count");

      // This order exists only to exercise the write path, and it is never
      // approved, so it is removed rather than left behind as a pending order
      // that would keep showing up in a manager's queue. The order the lifecycle
      // is about is left alone above.
      await db.query(`delete from public.orders where id = $1`, [created.id]);
      const after = await one(`select count(*)::int as n from public.orders`);
      eq("sales/orders", after.n, before.n, "the proxy order was cleaned up");
    }
  }
}

// ------------------- 11. finance edits a dealer's credit limit through the UI ---
{
  // Legacy Agro Supplies is the dealer with a zero limit, so raising and
  // restoring it is a visible change rather than a rewrite of the same number.
  const dealer = await one(
    `select id, name, credit_limit::numeric as credit_limit
       from dealers order by credit_limit asc, name limit 1`,
  );
  check("internal/finance", Boolean(dealer), "no dealer was available to edit");

  if (dealer) {
    const raised = Math.max(50000, Math.round(Number(dealer.credit_limit)) + 25000);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
    const { page, seen } = await login(context, "finance");
    await visit(page, `${BASE}/internal/finance`);

    // One form per dealer, each in a card headed by the dealer's name, so the
    // right one is found by looking at the card rather than trusting an index.
    const forms = page.locator("main form").filter({ has: page.getByRole("button", { name: /save dealer account/i }) });
    const total = await forms.count();
    let form = null;
    for (let index = 0; index < total; index += 1) {
      const card = await forms.nth(index).locator("xpath=../..").innerText();
      if (card.includes(dealer.name)) {
        form = forms.nth(index);
        break;
      }
    }

    if (!form) {
      fail("internal/finance", `no dealer credit form was rendered for ${dealer.name}`);
    } else {
      // The direct-write grant is split by column, so a finance user must not be
      // offered the sales rep picker: the database would refuse that column for
      // this role, and offering it would be a form that cannot succeed.
      eq("internal/finance", await form.getByLabel(/sales rep/i).count(), 0, "finance is not offered the admin-only rep picker");

      await form.getByLabel(/base credit limit/i).fill(String(raised));
      await form.getByRole("button", { name: /save dealer account/i }).click();
      const saved = await form
        .getByText(/dealer account updated/i)
        .waitFor({ timeout: 30000 })
        .then(() => true)
        .catch(() => false);
      step("dealer credit", saved ? `${dealer.name} limit set to ${raised} via the browser` : "no confirmation appeared");
      if (!saved) await page.screenshot({ path: path.join(SHOTS, "FAILED-11-credit.png"), fullPage: true });

      const written = await one(`select credit_limit::numeric as credit_limit from public.dealers where id = $1`, [dealer.id]);
      eq("internal/finance", Number(written.credit_limit), raised, "credit limit as typed");

      // Put it back, so a rerun starts from the same place and the seed is not
      // quietly reshaped by running the tests.
      await form.getByLabel(/base credit limit/i).fill(String(Number(dealer.credit_limit)));
      await form.getByRole("button", { name: /save dealer account/i }).click();
      const restored = await form
        .getByText(/dealer account updated/i)
        .waitFor({ timeout: 30000 })
        .then(() => true)
        .catch(() => false);
      check("internal/finance", restored, "the credit limit could not be restored through the browser");
      const back = await one(`select credit_limit::numeric as credit_limit from public.dealers where id = $1`, [dealer.id]);
      eq("internal/finance", Number(back.credit_limit), Number(dealer.credit_limit), "credit limit restored");
      step("dealer credit restore", `${dealer.name} limit back at ${Number(dealer.credit_limit)}`);
    }
    seen.drain();
    await context.close();
  }
}

await browser.close();
    await db.end();
    process.exit(1);
  }

  await row.locator("input[type=number]").fill(String(QTY));
  const shownTotal = (await page.locator("main").innerText()).match(/Order total\s*\u20B9([\d,]+(?:\.\d+)?)/);
  step("dealer price read", `${SKU} at ${unitPrice}, ordered ${QTY}, cart shows ${shownTotal ? inr(shownTotal[1]) : "?"}`);

  await page.getByRole("button", { name: "Submit order" }).click();
  const submitted = page.getByText("Order submitted. Sales review is now pending.");
  const ok = await submitted
    .waitFor({ timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    const body = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    fail("dealer/catalog", `order was not confirmed; page said: ${body.slice(0, 300)}`);
    await page.screenshot({ path: path.join(SHOTS, "FAILED-1-submit.png"), fullPage: true });
  } else {
    step("order submitted", "dealer portal confirmed submission");
  }
  seen.drain();
  if (status >= 400) fail("dealer/catalog", `returned ${status}`);
  await context.close();
}

// ------------------------------------------- resolve the order in the database ---
const created = await one(
  `select o.id, o.status, o.total_amount, o.dealer_id, o.credit_override
   from public.orders o
   where o.dealer_id = $1 and o.created_at > $2
   order by o.created_at desc limit 1`,
  [DEALER_ID, new Date(startedAt.getTime() - 5000)],
);
// Print whatever was gathered and stop. Used when a step fails so hard that
// continuing would dereference a value that does not exist: a raw TypeError
// halfway down the file hides the real problem and skips the summary.
async function bail() {
  await browser.close().catch(() => {});
  await db.end().catch(() => {});
  for (const p of problemsFromBrowser) if (!problems.includes(p)) problems.push(p);
  console.log("");
  console.log(log.join("\n"));
  console.log("");
  if (problems.length) {
    console.log(`${problems.length} problem(s):`);
    for (const p of problems) console.log(`  ${p}`);
    process.exit(1);
  }
  console.log("stopped early with no recorded problem");
  process.exit(1);
}

if (!created) {
  fail("database", "no new order appeared for Coastal after the dealer submitted one");
  await bail();
} else {
  orderId = created.id;
  step("order located", `${orderId.slice(0, 8)} status=${created.status} total=${created.total_amount}`);
  same("database", created.status, "pending", "initial status");
}

const lines = await db.query(
  `select oi.product_id, oi.quantity, oi.unit_price, oi.line_total
   from public.order_items oi where oi.order_id = $1`,
  [orderId],
);
if (lines.rows.length !== 1) {
  fail("database", `expected exactly 1 order line, found ${lines.rows.length}`);
} else {
  const l = lines.rows[0];
  step("order line", `${l.quantity} x ${l.unit_price} = ${l.line_total}`);
  eq("database", l.quantity, QTY, "line quantity");
  eq("database", l.line_total, Number(l.quantity) * Number(l.unit_price), "line arithmetic");
  eq("database", created.total_amount, l.line_total, "order total equals its line total");
}

// --------------------------------------------------- 2. sales approves ---
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const { page, seen } = await login(context, "sales");
  const totalText = inr(created.total_amount);
  await visit(page, `${BASE}/sales/orders`);

  const panel = page
    .locator("main section")
    .filter({ hasText: totalPattern(created.total_amount) })
    .filter({ has: page.getByRole("button", { name: "Approve", exact: true }) });
  if ((await panel.count()) !== 1) {
    fail("sales/orders", `expected exactly 1 pending panel showing \u20B9${totalText}, found ${await panel.count()}`);
  } else {
    await panel.first().getByRole("button", { name: "Approve", exact: true }).click();
    const approved = await waitForBadge(page, created.total_amount, "Approved");
    if (approved) step("order approved", `sales manager approved ${totalText}`);
    else {
      fail("sales/orders", `panel did not reach Approved after clicking Approve`);
      await page.screenshot({ path: path.join(SHOTS, "FAILED-2-approve.png"), fullPage: true });
    }
  }
  seen.drain();
  await context.close();
}

{
  const after = await one(`select status, approved_by is not null as has_approver, credit_override from public.orders where id = $1`, [orderId]);
  same("database", after.status, "approved", "status after approve");
  check("database", after.has_approver === true, "approved_by was not recorded");
  check("database", after.credit_override === false, "order was flagged as a credit override");

  const approval = await one(`select action, credit_limit, exposure_before, exposure_after from public.order_approvals where order_id = $1`, [orderId]);
  if (!approval) {
    fail("database", "no order_approvals row was written");
  } else {
    step("approval row", `action=${approval.action}, exposure ${approval.exposure_before} -> ${approval.exposure_after}`);
    same("database", approval.action, "approved", "approval action");
    eq("database", approval.credit_limit, 300000, "credit limit snapshot");
    // A pending order already counts toward exposure, so exposure_before already
    // includes it and approving must not move the number. That the figure equals
    // the pre-order baseline plus this order is what proves the order was counted.
    eq("database", approval.exposure_before, Number(baseline.exposure) + Number(created.total_amount), "pending order already counted in exposure");
    eq("database", approval.exposure_after, approval.exposure_before, "approving did not change exposure");
  }
}

// ------------------------------------------------ 3. logistics dispatches ---
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const { page, seen } = await login(context, "logistics");
  const totalText = inr(created.total_amount);
  await visit(page, `${BASE}/internal/orders`);

  const panel = page
    .locator("main section")
    .filter({ hasText: totalPattern(created.total_amount) })
    .filter({ has: page.getByRole("button", { name: "Mark dispatched" }) });
  if ((await panel.count()) !== 1) {
    fail("internal/orders", `expected exactly 1 approved panel showing ${totalText}, found ${await panel.count()}`);
  } else {
    await panel.first().locator("input").first().fill(NOTE);
    await panel
      .first()
      .getByRole("button", { name: "Mark dispatched" })
      .first()
      .click();

    // /internal/orders only lists approved orders in "Ready to dispatch", and the
    // "Dispatched history" panel shows the date and tracking note but not the
    // total. So the order leaving the queue, and the note reaching history, is
    // what proves the page caught up. Waiting for a status pill on a panel
    // keyed by the total can never pass here.
    let leftQueue = false;
    try {
      await page
        .locator("main section")
        .filter({ hasText: "Ready to dispatch" })
        .filter({ hasText: totalPattern(created.total_amount) })
        .waitFor({ state: "detached", timeout: 30000 });
      leftQueue = true;
    } catch {
      leftQueue = false;
    }
    check("internal/orders", leftQueue, "the order is still listed under Ready to dispatch after being dispatched");

    const noted = page.locator("main section").filter({ hasText: "Dispatched history" }).filter({ hasText: NOTE });
    const arrived = (await noted.count()) > 0;
    if (arrived) step("order dispatched", `left the queue, "${NOTE}" reached Dispatched history`);
    else {
      fail("internal/orders", `Dispatched history never showed the tracking note "${NOTE}"`);
      await page.screenshot({ path: path.join(SHOTS, "FAILED-3-dispatch.png"), fullPage: true });
    }
  }
  seen.drain();
  await context.close();
}

{
  const after = await one(`select status, dispatch_date, tracking_note from public.orders where id = $1`, [orderId]);
  same("database", after.status, "dispatched", "status after dispatch");
  check("database", Boolean(after.dispatch_date), "dispatch_date was not recorded");
  same("database", after.tracking_note, NOTE, "tracking note as typed");
}

// ------------------------------------- 4. finance generates the invoice ---
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const { page, seen } = await login(context, "finance");
  const totalText = inr(created.total_amount);
  await visit(page, `${BASE}/internal/finance`);

  const queue = page.locator("main section").filter({ hasText: "Invoice queue" });
  // Scope to the row element itself (the one carrying py-4). A bare `div` filter
  // also matches the wrapper and the inner cell, so it finds three nodes for one
  // order instead of one.
  const row = queue
    .locator("div.py-4")
    .filter({ hasText: totalPattern(created.total_amount) })
    .filter({ has: page.getByRole("button", { name: "Generate invoice" }) });
  if ((await row.count()) !== 1) {
    fail("internal/finance", `expected exactly 1 invoice-queue row for ${totalText}, found ${await row.count()}`);
  } else {
    await row.getByRole("button", { name: "Generate invoice" }).click();
    const made = await page
      .getByText("Invoice generated.")
      .waitFor({ timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    if (made) step("invoice generated", "finance portal confirmed");
    else {
      fail("internal/finance", "no 'Invoice generated.' confirmation appeared");
      await page.screenshot({ path: path.join(SHOTS, "FAILED-4-invoice.png"), fullPage: true });
    }
  }
  seen.drain();
  await context.close();
}

{
  // public.invoices carries no status or paid_amount column. Payment state is
  // derived from payments, payment_allocations and dealer_ledger, so assert
  // against those rather than inventing a status.
  const inv = await one(`select id, invoice_number, total_amount, taxable_amount, gst_amount from public.invoices where order_id = $1`, [orderId]);
  if (!inv) {
    fail("database", "no invoice exists for the order");
  } else {
    invoiceId = inv.id;
    invoiceNumber = inv.invoice_number;
    invoiceTotal = inv.total_amount;
    step("invoice row", `${invoiceNumber} total=${inv.total_amount}`);
    eq("database", inv.total_amount, created.total_amount, "invoice total matches order");
    // Compare in 2-decimal money steps. 5137.50 / 1.18 is 4353.81355..., so the
    // expected GST has to be rounded too or binary floating point reports
    // 783.6899999999996 against a stored 783.69.
    const taxable = Math.round((Number(inv.total_amount) / 1.18) * 100) / 100;
    eq("database", inv.taxable_amount, taxable, "taxable = total / 1.18, rounded");
    eq("database", inv.gst_amount, Math.round((Number(inv.total_amount) - taxable) * 100) / 100, "gst = total - taxable");

    const orderAfter = await one(`select status from public.orders where id = $1`, [orderId]);
    same("database", orderAfter.status, "invoiced", "order status after invoicing");

    const early = await one(`select count(*)::int as n from public.payments where invoice_id = $1`, [invoiceId]);
    eq("database", early.n, 0, "no payment recorded against a fresh invoice");
  }
}

// ------------------------------------------ 5. finance pays it in full ---
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const { page, seen } = await login(context, "finance");
  await visit(page, `${BASE}/internal/finance`);

  const register = page.locator("main section").filter({ hasText: "Invoice register" });
  // p-4 is the invoice card; the form and the inner columns do not carry it.
  const entry = register
    .locator("div.p-4")
    .filter({ hasText: invoiceNumber })
    .filter({ has: page.getByRole("button", { name: "Record" }) });
  if ((await entry.count()) !== 1) {
    fail("internal/finance", `expected exactly 1 invoice-register entry for ${invoiceNumber}, found ${await entry.count()}`);
  } else {
    const outstandingBefore = (await entry.first().innerText()).match(/Outstanding\s*\u20B9([\d,]+(?:\.\d+)?)/);
    step("outstanding before", outstandingBefore ? outstandingBefore[1] : "?");
    await entry.first().locator('input[placeholder="Amount"]').fill(String(invoiceTotal));
    await entry.first().locator("select").selectOption("upi");
    await entry.first().locator('input[placeholder="Reference"]').fill("E2E-UPI-001");
    await entry.first().getByRole("button", { name: "Record" }).click();
    const paid = await page
      .getByText("Payment recorded.")
      .waitFor({ timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    if (paid) step("payment recorded", `paid ${inr(invoiceTotal)} by UPI`);
    else {
      fail("internal/finance", "no 'Payment recorded.' confirmation appeared");
      await page.screenshot({ path: path.join(SHOTS, "FAILED-5-payment.png"), fullPage: true });
    }
  }
  seen.drain();
  await context.close();
}

// ------------------------------------------------------- final assertions ---
{
  const inv = await one(`select total_amount from public.invoices where id = $1`, [invoiceId]);

  const pay = await one(
    `select count(*)::int as n, coalesce(sum(amount), 0) as total from public.payments where invoice_id = $1`,
    [invoiceId],
  );
  step("payments", `${pay.n} payment(s) totalling ${pay.total}`);
  eq("database", pay.n, 1, "payments against the invoice");
  eq("database", pay.total, inv.total_amount, "payments equal the invoice total");

  const mode = await one(`select mode, reference from public.payments where invoice_id = $1`, [invoiceId]);
  same("database", mode.mode, "upi", "payment mode as chosen in the form");
  same("database", mode.reference, "E2E-UPI-001", "payment reference as typed");

  const alloc = await one(
    `select count(*)::int as n, coalesce(sum(amount), 0) as total from public.payment_allocations where invoice_id = $1`,
    [invoiceId],
  );
  eq("database", alloc.n, 1, "allocation rows");
  eq("database", alloc.total, inv.total_amount, "allocated amount");

  const ledger = await one(
    `select total_amount, paid_amount, outstanding_amount from public.dealer_ledger where invoice_id = $1`,
    [invoiceId],
  );
  if (!ledger) {
    fail("database", "no dealer_ledger row exists for the invoice");
  } else {
    step("ledger", `total ${ledger.total_amount}, paid ${ledger.paid_amount}, outstanding ${ledger.outstanding_amount}`);
    eq("database", ledger.outstanding_amount, 0, "ledger outstanding");
    eq("database", ledger.paid_amount, inv.total_amount, "ledger paid");
    eq("database", Number(ledger.paid_amount) + Number(ledger.outstanding_amount), ledger.total_amount, "ledger splits its own total");
    eq("database", ledger.total_amount, inv.total_amount, "ledger total matches the invoice");
  }

  const stock = await one(`select available_quantity::numeric as available from public.dealer_catalog where sku = $1`, [SKU]);
  eq("database", Number(baseline.available) - Number(stock.available), QTY, `${SKU} stock reduction`);

  const exposure = await one(`select private.order_exposure($1)::numeric as exposure`, [DEALER_ID]);
  eq("database", exposure.exposure, baseline.exposure, "dealer exposure back to baseline");

  const counts = await one(
    `select (select count(*)::int from public.orders) as orders,
            (select count(*)::int from public.invoices) as invoices,
            (select count(*)::int from public.payments) as payments`,
  );
  step("row counts", `orders ${baseline.orders}->${counts.orders}, invoices ${baseline.invoices}->${counts.invoices}, payments ${baseline.payments}->${counts.payments}`);
  eq("database", counts.orders, baseline.orders + 1, "orders added");
  eq("database", counts.invoices, baseline.invoices + 1, "invoices added");
  eq("database", counts.payments, baseline.payments + 1, "payments added");
}

// -------------------------------------------- 6. qc_staff records a verdict ---
// qc_staff has column-level UPDATE on production_runs(qc_status, qc_notes) and
// nothing else, so this is the check that a quality verdict lands and that the
// other columns on the same row are not reachable from the same UI.
//
// The run is provisioned by this step rather than borrowed from the seed, because
// a verdict is final by design: the guard trigger refuses any change once a run is
// passed or failed, so a seeded 'pending' run could only ever be consumed once and
// the test would pass on a clean database and fail on the second run. Passing a
// run also records its output into stock, so the cleanup removes the movement row
// (its trigger fires on DELETE and reverses the level) and then the run.
{
  const product = await one(
    `select product_id, current_quantity::numeric as stock from public.stock_levels order by product_id limit 1`,
  );
  const manager = await one(`select id from public.users where role = 'production_manager' limit 1`);
  if (!product || !manager) {
    fail("internal/quality", "no stock level or production_manager account available to provision a test run");
  } else {
    const created = await db.query(
      `insert into public.production_runs (run_date, shift, product_id, quantity_produced, qc_status, created_by)
       values (current_date, 'morning', $1, 1, 'pending', $2) returning id`,
      [product.product_id, manager.id],
    );
    const runId = created.rows[0].id;
    const note = "E2E QC verdict";
    try {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
      const { page, seen } = await login(context, "qc");
      await visit(page, `${BASE}/internal/quality`);

      const runSelect = page.getByLabel(/production run/i).first();
      if ((await runSelect.count()) === 0) {
        fail("internal/quality", "no production run selector was rendered for qc_staff");
      } else {
        await runSelect.selectOption(runId);
        const form = page.locator("main form").filter({ has: page.getByRole("button", { name: /record verdict/i }) });
        if ((await form.count()) === 0) {
          fail("internal/quality", "no QC verdict form appeared after choosing a run");
        } else {
          await form.getByLabel(/qc status/i).selectOption("passed");
          await form.getByLabel(/qc notes/i).fill(note);
          await form.getByRole("button", { name: /record verdict/i }).click();
          const saved = await form
            .getByText(/QC status updated/i)
            .waitFor({ timeout: 30000 })
            .then(() => true)
            .catch(() => false);
          step("qc verdict", saved ? "recorded via the browser" : "no confirmation appeared");
          if (!saved) await page.screenshot({ path: path.join(SHOTS, "FAILED-6-qc.png"), fullPage: true });
        }
        seen.drain();
        await context.close();
      }

      const after = await one(
        `select qc_status, qc_notes, quantity_produced::numeric as quantity_produced
           from public.production_runs where id = $1`,
        [runId],
      );
      same("internal/quality", after.qc_status, "passed", "qc_status as chosen in the form");
      same("internal/quality", after.qc_notes, note, "qc_notes as typed");
      eq("internal/quality", Number(after.quantity_produced), 1, "a QC verdict must not change quantity_produced");

      // A verdict on a passing run is what records its output into stock.
      const moved = await one(
        `select count(*)::int as n from public.stock_movements
           where source = 'production' and reference_id = $1`,
        [runId],
      );
      eq("internal/quality", moved.n, 1, "passing a run records one production movement");
    } finally {
      // Reverse in dependency order: the movement's own trigger restores the
      // stock level, then the run can go.
      await db.query(
        `delete from public.stock_movements where source = 'production' and reference_id = $1`,
        [runId],
      );
      await db.query(`delete from public.production_runs where id = $1`, [runId]);
      const restored = await one(
        `select current_quantity::numeric as stock from public.stock_levels where product_id = $1`,
        [product.product_id],
      );
      eq("internal/quality", Number(restored.stock), Number(product.stock), "stock level back to its pre-test value");
    }
  }
}

// ------------------------------- 7. finance_settings round-trips through the UI ---
{
  const before = await one(
    `select ageing_grace_days from public.finance_settings where id`,
  );
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const { page, seen } = await login(context, "finance");
  await visit(page, `${BASE}/internal/finance`);

  // Nudge grace days by one so the assertion proves a real write rather than a
  // page that merely rendered.
  const grace = page.getByLabel(/days before an invoice is treated as overdue/i).first();
  if ((await grace.count()) === 0) {
    fail("internal/finance", "no ageing grace period input was found");
  } else {
    const current = Number((await grace.inputValue()) || "0");
    const next = current === 0 ? 7 : current - 1;
    await grace.fill(String(next));
    await page.getByRole("button", { name: /save finance settings/i }).first().click();
    const saved = await page
      .getByText(/finance settings updated/i)
      .first()
      .waitFor({ timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    step("finance settings", saved ? `grace days set to ${next}` : "no confirmation appeared");
    if (!saved) await page.screenshot({ path: path.join(SHOTS, "FAILED-7-settings.png"), fullPage: true });

    const after = await one(`select ageing_grace_days from public.finance_settings where id`);
    eq(
      "internal/finance",
      Number(after.ageing_grace_days),
      next,
      `ageing_grace_days after the save (was ${before.ageing_grace_days})`,
    );
  }
  seen.drain();
  await context.close();

  // finance_settings is a single row a finance user reads, so put the grace
  // period back rather than leaving the harness's value on screen.
  await db.query(`update public.finance_settings set ageing_grace_days = $1 where id`, [
    before.ageing_grace_days,
  ]);
  const restored = await one(`select ageing_grace_days from public.finance_settings where id`);
  eq("internal/finance", Number(restored.ageing_grace_days), Number(before.ageing_grace_days), "grace days restored");
}

// ------------------------------- 8. purchase order is raised through the UI ---
{
  const supplier = `E2E Supplier ${Date.now()}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const { page, seen } = await login(context, "inventory");
  await visit(page, `${BASE}/internal/purchasing`);

  // The picker is fed by getRawMaterialProducts, which reads products, not the
  // raw_materials table, so a purchase order line is a product row. canSubmit
  // needs a supplier name plus a material, quantity and price on every line, so
  // fill all of them or the submit button stays disabled.
  await page.getByLabel(/^supplier$/i).first().fill(supplier);
  const material = page.getByLabel(/raw material/i).first();
  const handles = await material.locator("option").all();
  const options = (await Promise.all(handles.map((h) => h.getAttribute("value")))).filter(Boolean);
  if (options.length === 0) {
    fail("internal/purchasing", "purchase order form offered no material to order");
  } else {
    await material.selectOption(options[0]);
    await page.getByLabel(/^quantity$/i).first().fill("5");
    await page.getByLabel(/unit price/i).first().fill("250.00");
    await page.getByRole("button", { name: /raise purchase order/i }).first().click();
    const raised = await page
      .getByText(/purchase order raised/i)
      .first()
      .waitFor({ timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    step("purchase order", raised ? "raised via the browser" : "no confirmation appeared");
    if (!raised) await page.screenshot({ path: path.join(SHOTS, "FAILED-8-po.png"), fullPage: true });
  }
  seen.drain();
  await context.close();

  const po = await one(
    `select id, po_number, status from public.purchase_orders
      where supplier_name = $1 order by created_at desc limit 1`,
    [supplier],
  );
  check("internal/purchasing", Boolean(po), `no purchase_orders row was created for ${supplier}`);
  if (po) {
    step("purchase order row", `${po.po_number} status ${po.status}`);
    const line = await one(
      `select l.quantity::numeric as quantity, l.unit_price::numeric as unit_price
         from public.purchase_order_lines l where l.purchase_order_id = $1 limit 1`,
      [po.id],
    );
    check("internal/purchasing", Boolean(line), `purchase order ${po.po_number} has no line`);
    if (line) {
      eq("internal/purchasing", Number(line.quantity), 5, "ordered quantity as typed");
      eq("internal/purchasing", Number(line.unit_price), 250, "unit price as typed");
    }
  }
}

// -------------------------------- 9. batch is received into a lot with an expiry ---
{
  const batchCode = `E2E-${Date.now()}`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const { page, seen } = await login(context, "inventory");
  await visit(page, `${BASE}/internal/inventory`);

  // Scope to the form that owns the receive button: the page also renders a
  // movement form, and a select's accessible name includes the selected option's
  // text, so an anchored /^product$/ label match would miss.
  const form = page.locator("main form").filter({ has: page.getByRole("button", { name: /receive into batch/i }) });
  if ((await form.count()) === 0) {
    fail("internal/inventory", "no batch receive form was rendered for inventory_manager");
  } else {
    const product = form.getByLabel(/product/i).first();
    const handles = await product.locator("option").all();
    const options = (await Promise.all(handles.map((h) => h.getAttribute("value")))).filter(Boolean);
    if (options.length === 0) {
      fail("internal/inventory", "batch receive form offered no product to receive into");
    } else {
      await product.selectOption(options[0]);
      await form.getByLabel(/batch code/i).first().fill(batchCode);
      const expiry = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
      await form.getByLabel(/expiry date/i).first().fill(expiry);
      await form.getByLabel(/quantity/i).first().fill("7");
      await form.getByRole("button", { name: /receive into batch/i }).click();
      const received = await form
        .getByText(/batch received/i)
        .waitFor({ timeout: 30000 })
        .then(() => true)
        .catch(() => false);
      step("batch receive", received ? `received ${batchCode}` : "no confirmation appeared");
      if (!received) await page.screenshot({ path: path.join(SHOTS, "FAILED-9-batch.png"), fullPage: true });
    }
  }
  seen.drain();
  await context.close();

  const batch = await one(
    `select batch_code, quantity_received::numeric as quantity_received, expiry_date
       from public.product_batches where batch_code = $1`,
    [batchCode],
  );
  check("internal/inventory", Boolean(batch), `no product_batches row exists for ${batchCode}`);
  if (batch) {
    step("batch row", `${batch.batch_code} quantity ${batch.quantity_received} expiry ${batch.expiry_date}`);
    eq("internal/inventory", Number(batch.quantity_received), 7, "received quantity as typed");
  }
}

await browser.close();
await db.end();

console.log("");
if (problemsFromBrowser.length) {
  console.log("browser problems:");
  for (const p of problemsFromBrowser) console.log(`  ${p}`);
  problems.push(...problemsFromBrowser);
}

if (problems.length) {
  console.log("");
  console.log(`${problems.length} problem(s):`);
  for (const p of problems) console.log(`  ${p}`);
  process.exit(1);
}

console.log(`lifecycle passed: order ${orderId.slice(0, 8)} -> ${invoiceNumber} paid in full`);
console.log("  plus: qc verdict, finance settings, purchase order, batch receive");
console.log("  plus: proxy order by a sales rep, dealer credit edit by finance");
console.log("");
console.log(log.join("\n"));
