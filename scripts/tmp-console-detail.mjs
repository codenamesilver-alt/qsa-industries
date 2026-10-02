// Captures the *full* argument list of React key warnings, including any owner/component
// stack that React 19 attaches. Playwright's console event only surfaces the format
// string, which names a component but not the offending line, so the warning cannot be
// acted on from that alone. Serialising the args inside the page keeps the stack.
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const route = process.argv[2] ?? "/internal/purchasing";
const email = process.argv[3] ?? "admin@qsa-demo.in";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

await page.addInitScript(() => {
  window.__warnings = []; window.__probe = [];
  const original = console.error;
  console.log = (...args) => { const t = args.join(" "); if (/^PROBE/.test(t)) window.__probe.push(t); origLog(...args); };
  const origLog = console.log;
  console.error = (...args) => {
    const text = args
      .map((arg) => {
        if (typeof arg === "string") return arg;
        if (arg && typeof arg.stack === "string") return `<<stack>>\n${arg.stack}`;
        if (typeof arg === "function") return `<fn ${arg.name || "anonymous"}>`;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(" ");
    if (/^PROBE/i.test(text)) window.__probe.push(text);
    if (/unique .key.|missing .key./i.test(text)) {
      window.__warnings.push(`${text}\n<<jsstack>>\n${new Error("here").stack}`);
    }
    original(...args);
  };
});

await page.goto(`${BASE}/login/internal`, { waitUntil: "networkidle" });
await page.fill("#email", email);
await page.fill("#password", process.env.SMOKE_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 });

await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });

// Walk every section so lazy content mounts, and open a couple of rows.
const headers = page.locator("section > h2 > button[aria-expanded]");
for (let i = 0; i < (await headers.count()); i += 1) {
  await headers.nth(i).click().catch(() => {});
  await page.waitForTimeout(350);
}
const rows = page.locator("li > button[aria-expanded]");
for (let i = 0; i < Math.min(3, await rows.count()); i += 1) {
  await rows.nth(i).click().catch(() => {});
  await page.waitForTimeout(350);
}
await page.waitForTimeout(1000);

const probe = await page.evaluate(() => window.__probe ?? []);
for (const p of probe) console.log(`${p}\n`);
const warnings = await page.evaluate(() => window.__warnings ?? []);
console.log(`${warnings.length} key warning(s) on ${route}\n`);
for (const w of warnings) console.log(`${w}\n${"-".repeat(70)}`);

await browser.close();
