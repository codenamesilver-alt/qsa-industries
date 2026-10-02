// Browser smoke test for the three portals.
//
//   npm run ui:smoke            (expects a server already listening)
//
// Logs in as one account per role through the real login form, walks the routes
// that role should have, and fails on console errors, uncaught page errors, or
// failed network requests. Also checks the negative paths: an unauthenticated
// visitor must not reach a portal, and a dealer must be refused at the internal
// portal rather than quietly ending up somewhere harmless.
//
// Point it at a running server with SMOKE_BASE_URL. The demo password comes from
// SMOKE_PASSWORD so this never hardcodes a credential. Screenshots land in
// .smoke/ for eyeballing when something fails.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.SMOKE_BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const PASSWORD = process.env.SMOKE_PASSWORD;
const SHOTS = process.env.SMOKE_SHOTS ?? path.join(process.cwd(), ".smoke");

if (!PASSWORD) {
  console.error("Set SMOKE_PASSWORD to the demo account password.");
  process.exit(2);
}

// /internal/delivery is logistics and admin, /internal/admin is admin alone. They
// are listed here rather than left out so that a role change in requireProfile
// fails this test instead of quietly going untested.
const INTERNAL = [
  "/internal",
  "/internal/production",
  "/internal/inventory",
  "/internal/purchasing",
  "/internal/quality",
  "/internal/orders",
  "/internal/delivery",
  "/internal/finance",
  "/internal/admin",
  // Listed separately from the admin master because the two pages are gated by
  // the same role and do different jobs: the master is the catalogue of every
  // dealer fact, this is the queue of dealers who cannot trade yet. A route the
  // admin nav offers and this matrix never visits is the gap the matrix exists to
  // close, and a role that gains the nav link without the page guard would show up
  // here as a refusal rather than as a silent gap.
  "/internal/admin/dealers",
];
// /sales/team is deliberately not in SALES. It is gated to sales_manager alone,
// so adding it here would hand every rep and every director a refusal on a route
// that is refused by design, and the smoke would then be asserting the refusal
// rather than the screen. The manager entry below lists it explicitly.
const SALES = ["/sales", "/sales/orders", "/sales/reports"];
const SALES_TEAM = [...SALES, "/sales/team"];
const DEALER = ["/dealer", "/dealer/catalog", "/dealer/orders"];

// `routes` must render the role's own pages; `denied` must bounce to
// /unauthorized. The allowed/denied split mirrors the requireProfile calls in
// web/src/app, so a page whose role list changes shows up here as a failure
// rather than as silently untested coverage.
const ACCOUNTS = [
  {
    role: "admin",
    portal: "internal",
    email: "admin@qsa-demo.in",
    // /sales/orders is in this list, and not in the denied list, because
    // requireProfile on that page includes admin and the admin nav links to it.
    // A route the nav offers and the code permits, asserted nowhere, is the gap
    // this matrix is meant to close.
    routes: [...INTERNAL, "/sales/orders", "/sales/reports"],
    denied: ["/sales", "/dealer"],
  },
  {
    role: "production_manager",
    portal: "internal",
    email: "operations.production@qsa-demo.in",
    routes: ["/internal", "/internal/production", "/internal/inventory", "/internal/purchasing", "/internal/quality"],
    // Dispatch and delivery are both logistics questions, and the admin screen is
    // an admin one. Refusing them here is what stops a later role change from
    // quietly widening a role nobody intended to widen.
    denied: ["/internal/orders", "/internal/delivery", "/internal/finance", "/internal/admin", "/internal/admin/dealers", "/sales/reports"],
  },
  {
    role: "inventory_manager",
    portal: "internal",
    email: "operations.inventory@qsa-demo.in",
    routes: ["/internal", "/internal/inventory", "/internal/purchasing"],
    denied: [
      "/internal/production",
      "/internal/quality",
      "/internal/orders",
      "/internal/delivery",
      "/internal/finance",
      "/internal/admin",
      "/internal/admin/dealers",
      "/sales/reports",
    ],
  },
  // qc_staff is a quality-only role: it may see runs to judge and the materials
  // they consume, but nothing about production entry, stock, purchasing, orders,
  // or finance. This row is the test that keeps the role narrow.
  {
    role: "qc_staff",
    portal: "internal",
    email: "qc@qsa-demo.in",
    routes: ["/internal", "/internal/quality"],
    denied: [
      "/internal/production",
      "/internal/inventory",
      "/internal/purchasing",
      "/internal/orders",
      "/internal/delivery",
      "/internal/finance",
      "/internal/admin",
      "/internal/admin/dealers",
      "/sales",
      "/sales/reports",
      "/dealer",
    ],
  },
  {
    // Logistics is the one role the delivery board was written for: it reads the
    // whole order book but the dealers policy hides every dealer row from it, so
    // the board labels consignments through private.dealer_display_name instead
    // of joining. A 200 here with rows on it is the proof that fix holds.
    role: "logistics",
    portal: "internal",
    email: "logistics@qsa-demo.in",
    routes: ["/internal", "/internal/orders", "/internal/delivery"],
    content: { "/internal/delivery": [/Ready to dispatch/] },
    denied: [
      "/internal/production",
      "/internal/inventory",
      "/internal/purchasing",
      "/internal/quality",
      "/internal/finance",
      "/internal/admin",
      "/internal/admin/dealers",
    ],
  },
  {
    role: "finance",
    portal: "internal",
    email: "finance@qsa-demo.in",
    // /sales/reports is finance's because the reporting views are visible to them
    // in the database, not just to the sales hierarchy. Their outstanding figures
    // are the same realized/pipeline/outstanding split the finance screens use, so
    // refusing the screen would leave them reading a number with no drill-down.
    routes: ["/internal", "/internal/purchasing", "/internal/finance", "/sales/reports"],
    denied: [
      "/internal/production",
      "/internal/inventory",
      "/internal/quality",
      "/internal/orders",
      "/internal/delivery",
      "/internal/admin",
      "/internal/admin/dealers",
    ],
  },
  // A rep and a director are both refused /sales/team. A rep has no team to
  // reassign; a director assigns across managers by a different rule. Both are
  // refused on purpose rather than shown an empty screen, so the refusal is
  // asserted for each of them separately.
  { role: "sales_rep", portal: "sales", email: "ravi.menon@qsa-demo.in", routes: SALES, denied: ["/internal", "/internal/delivery", "/internal/admin", "/internal/admin/dealers", "/dealer", "/sales/team"], content: { "/sales/orders": [/Proxy order/] } },
  {
    role: "sales_manager",
    portal: "sales",
    email: "meera.nair@qsa-demo.in",
    routes: SALES_TEAM,
    // The two new screens are listed by their own paths, not only through
    // /internal. A role gate on the parent would refuse a sales user today, but
    // only the leaf routes prove the gate on each page rather than on the layout
    // that happens to wrap it.
    denied: ["/internal", "/internal/delivery", "/internal/admin", "/internal/admin/dealers", "/dealer"],
    // create_dealer_order accepts a dealer only for the dealer itself, a mapped
    // sales rep, or an admin. A manager reaching the proxy form would only ever
    // get an error back, so the panel must not be offered to them at all.
    absent: { "/sales/orders": [/Proxy order/] },
    // The reporting screen must show a manager their team's regions, not only
    // their own. A single-dealer manager would still pass a bare 200 check, so
    // the panel heading is asserted to be present.
    content: {
      "/sales/reports": [/Sales trend by period/],
      // /sales/team is the only screen that proves the manager can reassign a
      // dealer. "Reassign a dealer" is the panel that carries the form, so its
      // absence means the RPC or the coverage view is broken and the page
      // rendered without the control it exists for.
      "/sales/team": [/Reassign a dealer/, /Coverage by rep/, /Dealer accounts/],
    },
  },
  {
    role: "sales_director",
    portal: "sales",
    email: "nadia.kapoor@qsa-demo.in",
    routes: SALES,
    denied: ["/internal", "/internal/delivery", "/internal/admin", "/internal/admin/dealers", "/dealer", "/sales/team"],
    absent: { "/sales/orders": [/Proxy order/] },
    content: { "/sales/reports": [/Sales trend by period/] },
  },
  {
    role: "dealer",
    portal: "dealer",
    email: "dealer@qsa-demo.in",
    routes: DEALER,
    // A dealer must not reach the delivery board either. The board is
    // security_invoker on orders, so a dealer would see their own consignments if
    // the route gate were the only control; the route gate is the control.
    denied: ["/internal", "/internal/finance", "/internal/delivery", "/internal/admin", "/internal/admin/dealers", "/sales", "/sales/reports"],
  },
];

const DESTINATION = { internal: "/internal", sales: "/sales", dealer: "/dealer" };

// Noise that is not a defect in this app.
const IGNORE = [/favicon/i, /Download the React DevTools/i, /supabase.*rate limit/i];

// A 200 that renders an empty shell, a Next.js error boundary, or a page whose
// RLS query returned nothing all look identical to a healthy page if you only
// check status codes, so the walk also asserts the body actually has content.
const ERROR_TEXT = [
  /Application error/i,
  /Internal Server Error/i,
  /Something went wrong/i,
  /This page could not be found/i,
  /Unexpected Application Error/i,
];

// Markers of real, correctly scoped data. A 200 that renders an empty shell, an
// error boundary, or the marketing homepage instead of the requested page all look
// healthy on status alone, so the walk asserts the body too. These track the demo
// dataset, so they need updating if the seeded copy changes.
const CONTENT = {
  "/internal": [/Stock positions/],
  "/internal/production": [/QSA-BROILER-0\d/],
  "/internal/inventory": [/QSA-LAYER-01|QSA-BROILER-0\d/],
  "/internal/purchasing": [/Raise purchase order/, /Purchase order register/],
  "/internal/quality": [/Record QC verdict/, /Quality queue/],
  "/internal/orders": [/Mark dispatched|Dispatch queue/],
  "/internal/delivery": [/Ready to dispatch|Awaiting delivery confirmation/],
  "/internal/finance": [/QSA-2026-\d{4}/],
  // The admin screen renders the create-product form above the catalogue, so the
  // heading alone is enough to prove the page is the admin one and not an
  // unauthorized redirect that happens to carry the word "admin".
  "/internal/admin": [/Create a product/, /Price list/, /Users, roles and reporting lines/],
  // The onboarding queue. Asserted on the two halves of the page rather than on
  // one heading: "Start an onboarding" proves the create form rendered, and the
  // metrics prove the read model answered, so a page that rendered the heading
  // with a broken board would still fail here. A dealer name is deliberately not
  // asserted, because the queue is empty on a fresh database and the smoke has to
  // pass on one.
  "/internal/admin/dealers": [/Onboard a dealer/, /Start an onboarding/, /Open onboardings/, /Onboarding queue/],
  "/sales": [/Orders tracked/],
  "/sales/orders": [/Exposure/],
  "/dealer": [/Coastal Agri Enterprises/],
  "/dealer/catalog": [/QSA-/],
  "/dealer/orders": [/Coastal Agri Enterprises/],
};

// Next.js App Router speculatively prefetches linked routes and cancels the
// in-flight request when navigation happens first. Those surface as ERR_ABORTED
// on a `?_rsc=` URL and are not failures. An aborted top-level document request
// still counts, so this only excuses prefetches.
function isCancelledPrefetch(request) {
  const text = request.failure()?.errorText ?? "";
  return request.url().includes("_rsc=") && text.includes("ERR_ABORTED");
}

const problems = [];
const notes = [];

function flag(where, kind, detail) {
  problems.push(`${where}: ${kind} ${detail}`);
}

function watch(page, where) {
  const sink = { console: [], pageerror: [], requestfailed: [] };

  page.on("console", (msg) => {
    if (msg.type() !== "error" && msg.type() !== "warning") return;
    const text = msg.text();
    if (IGNORE.some((re) => re.test(text))) return;
    sink.console.push(`[${msg.type()}] ${text}`);
  });
  page.on("pageerror", (error) => sink.pageerror.push(error.message));
  page.on("requestfailed", (request) => {
    if (IGNORE.some((re) => re.test(request.url()))) return;
    if (isCancelledPrefetch(request)) return;
    const reason = request.failure()?.errorText ?? "";
    sink.requestfailed.push(`${request.method()} ${request.url()} ${reason}`);
  });

  return {
    // report only what arrived since the previous mark, so a console error is
    // attributed to the route that actually caused it
    drain(mark) {
      for (const [kind, list] of Object.entries(sink)) {
        for (const item of list.slice(mark[kind])) flag(where, kind, item);
        mark[kind] = list.length;
      }
    },
    mark() {
      return Object.fromEntries(Object.entries(sink).map(([k, v]) => [k, v.length]));
    },
  };
}

// `networkidle` is not a usable readiness signal here. Next.js prefetches every
// visible <Link>, so the network rarely stays quiet for 500ms and the wait hangs
// on pages that have in fact rendered fine. Wait for the document plus the main
// region, then settle briefly for client-side fetching.
async function visit(page, url) {
  const started = Date.now();
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
  await page.waitForSelector("main", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  return { status: response ? response.status() : 0, ms: Date.now() - started };
}

async function login(page, account) {
  await visit(page, `${BASE}/login/${account.portal}`);
  await page.fill("#email", account.email);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");

  const expected = DESTINATION[account.portal];
  try {
    await page.waitForURL((url) => url.pathname === expected, { timeout: 30000 });
  } catch {
    const message = await page
      .locator("[aria-live=polite]")
      .first()
      .textContent()
      .catch(() => null);
    throw new Error(
      `did not reach ${expected} (${page.url()})` +
        (message ? ` form said: ${message.trim()}` : ""),
    );
  }
  await page.waitForSelector("main", { timeout: 20000 }).catch(() => {});
}

fs.mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ headless: true });

// --- negative path 1: no session must not reach a portal ---------------------
{
  const context = await browser.newContext();
  const page = await context.newPage();
  for (const route of ["/internal", "/sales", "/dealer"]) {
    await visit(page, `${BASE}${route}`);
    if (new URL(page.url()).pathname === route) {
      flag("anonymous", "authz", `${route} rendered for an unauthenticated visitor`);
    }
  }
  notes.push(`anonymous visitor ends at ${new URL(page.url()).pathname}`);
  await context.close();
}

// --- negative path 2: wrong portal must be refused ---------------------------
{
  const context = await browser.newContext();
  const page = await context.newPage();
  await visit(page, `${BASE}/login/internal`);
  await page.fill("#email", "dealer@qsa-demo.in");
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  const refusal = page.locator("[aria-live=polite]").first();
  try {
    await refusal.waitFor({ timeout: 20000 });
    const text = (await refusal.textContent())?.trim() ?? "";
    if (!text) flag("dealer->internal", "authz", "refused but with no message");
    else notes.push(`dealer at internal portal refused: "${text}"`);
  } catch {
    flag("dealer->internal", "authz", `dealer was not refused, ended at ${page.url()}`);
  }
  await context.close();
}

// --- per role walk -----------------------------------------------------------
for (const account of ACCOUNTS) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const seen = watch(page, account.role);

  try {
    await login(page, account);
  } catch (error) {
    flag(account.role, "login", error.message);
    await context.close();
    continue;
  }

  for (const route of account.routes) {
    const mark = seen.mark();
    const slug = `${account.role}${route.replace(/\//g, "-") || "-root"}`;

    let result;
    try {
      result = await visit(page, `${BASE}${route}`);
    } catch (error) {
      seen.drain(mark);
      flag(account.role, "navigation", `${route}: ${error.message.split("\n")[0]}`);
      await page
        .screenshot({ path: path.join(SHOTS, `FAILED-${slug}.png`), fullPage: true })
        .catch(() => {});
      continue;
    }

    seen.drain(mark);
    if (result.status >= 400) flag(account.role, "http", `${route} returned ${result.status}`);

    const text = (await page
      .locator("main")
      .innerText()
      .catch(() => ""))
      .replace(/\s+/g, " ")
      .trim();

    if (text.length < 300) {
      flag(account.role, "content", `${route} rendered only ${text.length} chars of text`);
    }
    for (const re of ERROR_TEXT) {
      if (re.test(text)) flag(account.role, "content", `${route} shows an error page matching ${re}`);
    }
    for (const re of CONTENT[route] ?? []) {
      if (!re.test(text)) {
        flag(account.role, "content", `${route} rendered no data matching ${re} (${text.length} chars)`);
      }
    }
    // Extra markers that only hold for this account, e.g. a panel that must be
    // present for one role and absent for another.
    for (const re of account.content?.[route] ?? []) {
      if (!re.test(text)) {
        flag(account.role, "content", `${route} rendered no data matching ${re} (${text.length} chars)`);
      }
    }
    for (const re of account.absent?.[route] ?? []) {
      if (re.test(text)) {
        flag(account.role, "content", `${route} offered ${account.role} a panel matching ${re} that it cannot use`);
      }
    }

    await page.screenshot({ path: path.join(SHOTS, `${slug}.png`), fullPage: true });
    notes.push(
      `${account.role.padEnd(19)} ${route.padEnd(22)} ${String(result.status).padEnd(4)} ` +
        `${String(result.ms).padStart(5)}ms ${String(text.length).padStart(5)} chars`,
    );
  }

  // A role must be stopped at the door, and told why. Silently landing on the
  // public homepage used to pass every status check while looking like a broken
  // sign-in, so assert the redirect target and the explanation.
  for (const route of account.denied ?? []) {
    try {
      await visit(page, `${BASE}${route}`);
    } catch (error) {
      flag(account.role, "authz", `${route}: ${error.message.split("\n")[0]}`);
      continue;
    }

    const landed = new URL(page.url()).pathname;
    if (landed !== "/unauthorized") {
      flag(account.role, "authz", `${route} was served to ${account.role} (landed at ${landed})`);
      continue;
    }

    const text = (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ");
    if (!/outside your role/i.test(text)) {
      flag(account.role, "authz", `${route} was refused at /unauthorized but never said why`);
      continue;
    }
    if (!/Back to/i.test(text)) {
      flag(account.role, "authz", `/unauthorized offered ${account.role} no way back`);
      continue;
    }
    notes.push(`${account.role.padEnd(19)} ${route.padEnd(22)} refused, told why, offered a way back`);
  }

  await context.close();
}

await browser.close();

console.log(notes.join("\n"));
console.log("");

if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const problem of problems) console.log(`  ${problem}`);
  process.exit(1);
}

console.log(`ui smoke passed: ${ACCOUNTS.length} roles, screenshots in ${SHOTS}`);
