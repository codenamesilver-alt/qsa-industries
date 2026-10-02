// Measures the rendered height of every portal screen, per role.
//
// Height is the whole complaint: a page that renders every record's full edit form
// is unusable long before it is slow, and "adds one more row" made it worse every
// month. This prints the number so the fix can be argued with evidence rather than
// taste. Read-only; touches nothing.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SMOKE_PASSWORD;

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
  ["admin", [
    "/internal", "/internal/inventory", "/internal/purchasing", "/internal/production",
    "/internal/quality", "/internal/finance", "/internal/orders", "/internal/delivery",
    "/internal/org-chart", "/internal/admin", "/internal/admin/dealers", "/internal/users",
  ]],
  ["production_manager", ["/internal", "/internal/production", "/internal/quality"]],
  ["inventory_manager", ["/internal/inventory", "/internal/purchasing"]],
  ["logistics", ["/internal/orders", "/internal/delivery"]],
  ["finance", ["/internal/finance", "/internal/purchasing"]],
  ["sales_rep", ["/sales", "/sales/orders", "/sales/reports"]],
  ["sales_manager", ["/sales", "/sales/orders", "/sales/team", "/sales/reports"]],
  ["sales_director", ["/sales", "/sales/orders", "/sales/reports"]],
  ["dealer", ["/dealer", "/dealer/orders", "/dealer/catalog"]],
];

// Two viewports, because a page that fits a laptop can still be unusable on the
// floor of a warehouse, and the fix is the same either way.
const HEIGHTS = [
  { name: "laptop 1440x900", width: 1440, height: 900 },
  { name: "small 1280x720", width: 1280, height: 720 },
];

const browser = await chromium.launch();
const rows = [];

for (const [role, routes] of ROUTES) {
  const vp = HEIGHTS[0];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}${LOGIN_ROUTE[role]}`, { waitUntil: "networkidle" });
    await page.fill("#email", EMAILS[role]);
    await page.fill("#password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 });
  } catch (err) {
    console.log(`LOGIN FAILED ${role}`);
    await context.close();
    continue;
  }

  for (const route of routes) {
    for (const v of HEIGHTS) {
      await page.setViewportSize({ width: v.width, height: v.height });
      try {
        const res = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle", timeout: 60000 });
        const m = await page.evaluate(() => ({
          h: document.documentElement.scrollHeight,
          text: document.body.innerText.length,
          nodes: document.querySelectorAll("form").length,
          err: /Application error|Internal Server Error/i.test(document.body.innerText),
        }));
        rows.push({ role, route, vp: v.name, screens: Math.max(1, Math.round(m.h / v.height)), px: m.h, text: m.text, forms: m.nodes, status: res?.status() ?? 0, err: m.err });
      } catch (err) {
        rows.push({ role, route, vp: v.name, screens: -1, px: 0, text: 0, forms: 0, status: 0, err: true });
      }
    }
  }

  await context.close();
}

await browser.close();

// Worst first. Screens is the number of times you would have to scroll.
rows.sort((a, b) => b.screens - a.screens);

console.log("role              route                      viewport        screens    px      text    forms  status");
console.log("-".repeat(104));
for (const r of rows) {
  if (r.vp !== HEIGHTS[0].name) continue;
  const flag = r.err ? " ERR" : r.screens >= 6 ? " <<<" : "";
  console.log(
    `${r.role.padEnd(16)} ${r.route.padEnd(26)} ${r.vp.padEnd(15)} ${String(r.screens).padStart(6)} ${String(r.px).padStart(8)} ${String(r.text).padStart(8)} ${String(r.forms).padStart(6)}  ${r.status}${flag}`,
  );
}

const worst = rows.filter((r) => r.vp === HEIGHTS[0].name && r.screens >= 6);
console.log(`\n${worst.length} of ${rows.filter((r) => r.vp === HEIGHTS[0].name).length} screens are 6+ screens tall at 1440x900.`);
