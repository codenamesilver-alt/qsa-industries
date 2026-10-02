// Captures every portal screen as the role that owns it, for the three workflow
// PDFs. Login goes through the real form so the session cookie is exactly what a
// user gets, then each route is visited and screenshotted full page.
//
// Output: docs-shots/<slug>/<file>.png  (referenced by docs-shots/sheet.json)
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = path.resolve("docs-shots");
const PASSWORD = process.env.SMOKE_PASSWORD;

if (!PASSWORD) {
  console.error("SMOKE_PASSWORD is required.");
  process.exit(1);
}

const VIEWPORT = { width: 1440, height: 1000 };

// One entry per screenshot we want in the PDFs. Slugs are stable because the
// manuals reference them by name.
const SHOTS = [
  // --- Dealer portal, as a dealer ---
  { slug: "dealer", role: "dealer", file: "dealer-overview", route: "/dealer" },
  { slug: "dealer", role: "dealer", file: "dealer-orders", route: "/dealer/orders" },
  { slug: "dealer", role: "dealer", file: "dealer-catalog", route: "/dealer/catalog" },

  // --- Sales portal, by role ---
  { slug: "sales", role: "sales_rep", file: "sales-rep-overview", route: "/sales" },
  { slug: "sales", role: "sales_rep", file: "sales-rep-orders", route: "/sales/orders" },
  { slug: "sales", role: "sales_rep", file: "sales-rep-reports", route: "/sales/reports" },
  { slug: "sales", role: "sales_manager", file: "sales-manager-overview", route: "/sales" },
  { slug: "sales", role: "sales_manager", file: "sales-manager-orders", route: "/sales/orders" },
  { slug: "sales", role: "sales_manager", file: "sales-manager-team", route: "/sales/team" },
  { slug: "sales", role: "sales_manager", file: "sales-manager-reports", route: "/sales/reports" },
  { slug: "sales", role: "sales_director", file: "sales-director-overview", route: "/sales" },
  { slug: "sales", role: "sales_director", file: "sales-director-orders", route: "/sales/orders" },
  { slug: "sales", role: "sales_director", file: "sales-director-reports", route: "/sales/reports" },

  // --- Internal portal, by role ---
  { slug: "internal", role: "admin", file: "internal-admin-overview", route: "/internal" },
  { slug: "internal", role: "admin", file: "internal-admin-admin", route: "/internal/admin" },
  { slug: "internal", role: "admin", file: "internal-admin-onboarding", route: "/internal/admin/dealers" },
  { slug: "internal", role: "inventory_manager", file: "internal-inventory", route: "/internal/inventory" },
  { slug: "internal", role: "inventory_manager", file: "internal-purchasing", route: "/internal/purchasing" },
  { slug: "internal", role: "production_manager", file: "internal-production", route: "/internal/production" },
  { slug: "internal", role: "production_manager", file: "internal-production-quality", route: "/internal/quality" },
  { slug: "internal", role: "qc_staff", file: "internal-quality", route: "/internal/quality" },
  { slug: "internal", role: "qc_staff", file: "internal-quality-overview", route: "/internal" },
  { slug: "internal", role: "logistics", file: "internal-logistics-orders", route: "/internal/orders" },
  { slug: "internal", role: "logistics", file: "internal-delivery", route: "/internal/delivery" },
  { slug: "internal", role: "finance", file: "internal-finance", route: "/internal/finance" },
  { slug: "internal", role: "finance", file: "internal-finance-purchasing", route: "/internal/purchasing" },
];

const EMAILS = {
  admin: "admin@qsa-demo.in",
  production_manager: "operations.production@qsa-demo.in",
  inventory_manager: "operations.inventory@qsa-demo.in",
  qc_staff: "qc@qsa-demo.in",
  logistics: "logistics@qsa-demo.in",
  finance: "finance@qsa-demo.in",
  sales_rep: "ravi.menon@qsa-demo.in",
  sales_manager: "meera.nair@qsa-demo.in",
  sales_director: "nadia.kapoor@qsa-demo.in",
  dealer: "dealer@qsa-demo.in",
};

// Signs in once per role and keeps the page, because the login form posts and
// lands on the portal home. Each portal has its own form and its own allowed
// roles, so the role decides which form to use: signing a rep into the internal
// form is refused with "This account is not provisioned for this portal."
const LOGIN_ROUTE = {
  admin: "/login/internal",
  production_manager: "/login/internal",
  inventory_manager: "/login/internal",
  qc_staff: "/login/internal",
  logistics: "/login/internal",
  finance: "/login/internal",
  sales_rep: "/login/sales",
  sales_manager: "/login/sales",
  sales_director: "/login/sales",
  dealer: "/login/dealer",
};

async function signIn(page, email, role) {
  // networkidle, not domcontentloaded. The submit handler is attached during
  // hydration, and clicking before that lands does a native GET -- which puts the
  // password in the query string and leaves the page on /login with a 200, so it
  // looks like a rejected login rather than a race. Every role failed this way
  // until this was changed.
  await page.goto(`${BASE}${LOGIN_ROUTE[role]}`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  // router.replace fires client-side, so watch the URL rather than a navigation.
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 });
}

const browser = await chromium.launch();
const results = [];

for (const slug of ["dealer", "sales", "internal"]) {
  await fs.mkdir(path.join(OUT, slug), { recursive: true });
}

for (const role of Object.keys(EMAILS)) {
  const shots = SHOTS.filter((s) => s.role === role);
  if (shots.length === 0) continue;

  // One context per role: a fresh cookie jar, so a manager cannot inherit a
  // rep's session and quietly screenshot the wrong scope.
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();

  try {
    await signIn(page, EMAILS[role], role);
  } catch (err) {
    console.error(`  LOGIN FAILED ${role}: ${err.message.split("\n")[0]}`);
    await context.close();
    continue;
  }

  for (const shot of shots) {
    const target = `${BASE}${shot.route}`;
    try {
      const res = await page.goto(target, { waitUntil: "networkidle", timeout: 60000 });
      const status = res?.status() ?? 0;

      // networkidle can settle while a server component error page is on
      // screen, so record the H1 and the body length as evidence of what
      // actually rendered rather than trusting the status alone.
      const info = await page.evaluate(() => ({
        h1: document.querySelector("h1")?.textContent?.trim() ?? null,
        text: document.body.innerText.length,
        error: /Application error|Internal Server Error|server error/i.test(
          document.body.innerText,
        ),
      }));

      if (info.error || status >= 400) {
        console.error(`  FAIL ${shot.file} ${status} errorPage=${info.error} h1=${info.h1}`);
        results.push({ ...shot, ok: false, status, h1: info.h1, errorPage: info.error });
        continue;
      }

      const file = path.join(OUT, shot.slug, `${shot.file}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const bytes = (await fs.stat(file)).size;
      console.log(`  ok   ${shot.file.padEnd(30)} ${status} h1="${info.h1}" textLen=${info.text} ${Math.round(bytes / 1024)}kB`);
      results.push({ ...shot, ok: true, status, h1: info.h1, textLen: info.text, bytes });
    } catch (err) {
      console.error(`  ERR  ${shot.file}: ${err.message.split("\n")[0]}`);
      results.push({ ...shot, ok: false, error: err.message.split("\n")[0] });
    }
  }

  await context.close();
}

await browser.close();

await fs.writeFile(path.join(OUT, "sheet.json"), JSON.stringify(results, null, 2));

const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} screenshots captured`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log("failures:");
  for (const f of failed) console.log(`  ${f.file}: ${f.error ?? `status ${f.status}`}`);
  process.exit(1);
}
