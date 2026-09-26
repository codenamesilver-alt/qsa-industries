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
const QTY = Number(process.env.E2E_QTY ?? 137);
const NOTE = "E2E dispatch note";

if (!PASSWORD) {
  console.error("Set SMOKE_PASSWORD to the demo account password.");
  process.exit(2);
}

const ACCOUNTS = {
  dealer: { portal: "dealer", email: "dealer@qsa-demo.in", home: "/dealer" },
  sales: { portal: "sales", email: "meera.nair@qsa-demo.in", home: "/sales" },
  logistics: { portal: "internal", email: "logistics@qsa-demo.in", home: "/internal" },
  finance: { portal: "internal", email: "finance@qsa-demo.in", home: "/internal" },
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
const inr = (value) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value));

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
if (!created) {
  fail("database", "no new order appeared for Coastal after the dealer submitted one");
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
console.log("");
console.log(log.join("\n"));
