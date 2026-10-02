// Sweeps every route as every role that can reach it, and reports console errors,
// page errors and failed requests. The key-warning hunt showed that a single unkeyed
// server-rendered child can sit in a long list for months without anyone noticing in a
// screenshot, so this checks behaviour rather than appearance.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const LOGIN_ROUTE = {
  admin: "/login/internal",
  finance: "/login/internal",
  production_manager: "/login/internal",
  inventory_manager: "/login/internal",
  logistics: "/login/internal",
  sales_rep: "/login/sales",
  sales_manager: "/login/sales",
  sales_director: "/login/sales",
  dealer: "/login/dealer",
};

const ROLES = {
  admin: { email: "admin@qsa-demo.in", routes: ["/internal", "/internal/users", "/internal/admin", "/internal/admin/dealers", "/internal/finance", "/internal/inventory", "/internal/purchasing", "/internal/production", "/internal/orders", "/internal/delivery", "/internal/quality", "/internal/org-chart"] },
  finance: { email: "finance@qsa-demo.in", routes: ["/internal", "/internal/finance", "/internal/purchasing"] },
  production_manager: { email: "operations.production@qsa-demo.in", routes: ["/internal", "/internal/production", "/internal/quality"] },
  inventory_manager: { email: "operations.inventory@qsa-demo.in", routes: ["/internal", "/internal/inventory", "/internal/purchasing"] },
  logistics: { email: "logistics@qsa-demo.in", routes: ["/internal", "/internal/orders", "/internal/delivery"] },
  sales_rep: { email: "ravi.menon@qsa-demo.in", routes: ["/sales", "/sales/orders", "/sales/reports"] },
  sales_manager: { email: "meera.nair@qsa-demo.in", routes: ["/sales", "/sales/orders", "/sales/reports", "/sales/team"] },
  sales_director: { email: "nadia.kapoor@qsa-demo.in", routes: ["/sales", "/sales/orders", "/sales/reports"] },
  dealer: { email: "dealer@qsa-demo.in", routes: ["/dealer", "/dealer/catalog", "/dealer/orders"] },
};

// Page errors and React warnings are the signal. Favicon noise is not.
const IGNORE = [/favicon/i, /Download the React DevTools/i];

const browser = await chromium.launch();
const problems = [];

for (const [role, config] of Object.entries(ROLES)) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const bucket = [];
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const text = m.text();
    if (IGNORE.some((re) => re.test(text))) return;
    bucket.push(`[console.${m.type()}] ${text.slice(0, 300)}`);
  });
  page.on("pageerror", (e) => bucket.push(`[pageerror] ${String(e).slice(0, 300)}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && new URL(r.url()).origin === BASE) bucket.push(`[http ${r.status()}] ${r.url()}`);
  });

  await page.goto(`${BASE}${LOGIN_ROUTE[role] ?? "/login/internal"}`, { waitUntil: "networkidle" });
  await page.fill("#email", config.email);
  await page.fill("#password", process.env.SMOKE_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 });

  for (const route of config.routes) {
    bucket.length = 0;
    const response = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
    const status = response?.status();

    // Open every collapsed section so lazily-mounted children get exercised.
    const headers = page.locator("section > h2 > button[aria-expanded]");
    for (let i = 0; i < (await headers.count()); i += 1) {
      await headers.nth(i).click().catch(() => {});
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(250);

    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    const flag = status !== 200 || bucket.length ? "FAIL" : "ok  ";
    console.log(`${flag} ${role.padEnd(18)} ${route.padEnd(26)} ${String(height).padStart(6)}px ${status}`);
    for (const line of new Set(bucket)) {
      console.log(`       ${line}`);
      problems.push(`${role} ${route}: ${line}`);
    }
  }

  await context.close();
}

await browser.close();
console.log(`\n${problems.length} problem(s)`);
process.exit(problems.length ? 1 : 0);
