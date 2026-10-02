// Second capture pass, for the user guide PDF.
//
// The first pass (tmp-capture.mjs) takes one fullPage screenshot per route, which is
// the right shape for a bug report and the wrong shape for a printed page: the admin
// master data screen is 4.8MB and about 28,600 characters tall, and scaled to fit one
// sheet of paper it would be unreadable. So this pass slices any page taller than a
// threshold into viewport-height strips, one per PDF page, and captures the
// unauthenticated screens (the chooser and the three login forms), which the first
// pass cannot reach because it only visits routes it has signed in for.
//
// Output: docs-shots/<slug>/<file>.png and <file>-part2.png, ...
//         docs-shots/sheet.json, rewritten with the part list and pixel dimensions.
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
const SCALE = 2;

// A page up to this many CSS pixels tall is one image. Past it, it is sliced.
const ONE_SHEET = 1150;

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

const ROUTES = [
  { slug: "dealer", role: "dealer", file: "dealer-overview", route: "/dealer" },
  { slug: "dealer", role: "dealer", file: "dealer-orders", route: "/dealer/orders" },
  { slug: "dealer", role: "dealer", file: "dealer-catalog", route: "/dealer/catalog" },

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

  { slug: "internal", role: "admin", file: "internal-admin-overview", route: "/internal" },
  { slug: "internal", role: "admin", file: "internal-admin-admin", route: "/internal/admin" },
  { slug: "internal", role: "admin", file: "internal-users", route: "/internal/users" },
  { slug: "internal", role: "admin", file: "internal-admin-onboarding", route: "/internal/admin/dealers" },
  { slug: "internal", role: "admin", file: "internal-admin-orgchart", route: "/internal/org-chart" },
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

// Signed out. These need no account, which is why they are a separate list rather
// than a role in EMAILS.
const PUBLIC_ROUTES = [
  { slug: "public", file: "public-chooser", route: "/" },
  { slug: "public", file: "public-login-internal", route: "/login/internal" },
  { slug: "public", file: "public-login-sales", route: "/login/sales" },
  { slug: "public", file: "public-login-dealer", route: "/login/dealer" },
];

async function signIn(page, email, role) {
  // networkidle, not domcontentloaded. The submit handler is attached during
  // hydration; clicking before that lands does a native GET, which puts the password
  // in the query string and leaves the page on /login with a 200. It looks exactly
  // like a rejected login.
  await page.goto(`${BASE}${LOGIN_ROUTE[role]}`, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 });
}

async function renderShot(page, shot) {
  const res = await page.goto(`${BASE}${shot.route}`, { waitUntil: "networkidle", timeout: 60000 });
  const status = res?.status() ?? 0;

  const info = await page.evaluate(() => ({
    h1: document.querySelector("h1")?.textContent?.trim() ?? null,
    scrollHeight: document.documentElement.scrollHeight,
    error: /Application error|Internal Server Error|server error/i.test(document.body.innerText),
  }));

  if (info.error || status >= 400) {
    return { ...shot, ok: false, status, h1: info.h1, errorPage: info.error };
  }

  const dir = path.join(OUT, shot.slug);
  await fs.mkdir(dir, { recursive: true });

  const files = [];

  if (info.scrollHeight <= ONE_SHEET) {
    const file = path.join(dir, `${shot.file}.png`);
    await page.screenshot({ path: file, fullPage: true });
    files.push(path.relative(OUT, file).split(path.sep).join("/"));
  } else {
    // Sliced. Each strip is a viewport screenshot taken at a scroll offset, with a
    // little overlap so a row split across two strips is still readable on both.
    const step = VIEWPORT.height - 90;
    const total = info.scrollHeight;
    let n = 0;

    for (let y = 0; y < total; y += step) {
      n += 1;
      await page.evaluate((top) => window.scrollTo(0, top), y);
      // Give lazy content and sticky headers a beat to settle at the new offset.
      await page.waitForTimeout(450);

      const suffix = n === 1 ? "" : `-part${n}`;
      const file = path.join(dir, `${shot.file}${suffix}.png`);
      await page.screenshot({ path: file });
      files.push(path.relative(OUT, file).split(path.sep).join("/"));

      if (y + VIEWPORT.height >= total) break;
    }

    await page.evaluate(() => window.scrollTo(0, 0));
  }

  const bytes = (await Promise.all(files.map(async (f) => (await fs.stat(path.join(OUT, f))).size))).reduce((a, b) => a + b, 0);

  return {
    ...shot,
    ok: true,
    status,
    h1: info.h1,
    scrollHeight: info.scrollHeight,
    parts: files,
    bytes,
  };
}

const browser = await chromium.launch();
const results = [];

for (const slug of ["dealer", "sales", "internal", "public"]) {
  await fs.mkdir(path.join(OUT, slug), { recursive: true });
}

// Signed-out screens first, in their own context.
{
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
  const page = await context.newPage();
  for (const shot of PUBLIC_ROUTES) {
    try {
      const r = await renderShot(page, shot);
      results.push(r);
      console.log(`  ${r.ok ? "ok  " : "FAIL"} ${shot.file.padEnd(28)} ${r.h1 ?? ""}`);
    } catch (err) {
      results.push({ ...shot, ok: false, error: err.message.split("\n")[0] });
      console.log(`  ERR  ${shot.file}: ${err.message.split("\n")[0]}`);
    }
  }
  await context.close();
}

for (const role of Object.keys(EMAILS)) {
  const shots = ROUTES.filter((s) => s.role === role);
  if (shots.length === 0) continue;

  // One context per role: a fresh cookie jar, so a manager cannot inherit a rep's
  // session and quietly screenshot the wrong scope.
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
  const page = await context.newPage();

  try {
    await signIn(page, EMAILS[role], role);
  } catch (err) {
    console.log(`  LOGIN FAILED ${role}: ${err.message.split("\n")[0]}`);
    await context.close();
    continue;
  }

  for (const shot of shots) {
    try {
      const r = await renderShot(page, shot);
      results.push(r);
      console.log(
        `  ${r.ok ? "ok  " : "FAIL"} ${shot.file.padEnd(28)} h=${String(r.scrollHeight ?? "?").padStart(6)} parts=${(r.parts ?? []).length} ${r.h1 ?? ""}`,
      );
    } catch (err) {
      results.push({ ...shot, ok: false, error: err.message.split("\n")[0] });
      console.log(`  ERR  ${shot.file}: ${err.message.split("\n")[0]}`);
    }
  }

  await context.close();
}

await browser.close();
await fs.writeFile(path.join(OUT, "sheet.json"), JSON.stringify(results, null, 2));

const ok = results.filter((r) => r.ok).length;
const images = results.reduce((n, r) => n + (r.parts?.length ?? 0), 0);
console.log(`\n${ok}/${results.length} routes captured, ${images} images`);

const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log("failures:");
  for (const f of failed) console.log(`  ${f.file}: ${f.error ?? `status ${f.status}`}`);
  process.exit(1);
}
