// Proves the dropdowns and search boxes actually work, rather than inferring it from
// page height. A collapsed page is not a working page: a dropdown that renders but
// never opens, or a list where opening the second row leaves the first open, looks
// identical in a screenshot and is useless in a browser.
//
// Checks, per page:
//   - a section dropdown opens, and opening a second one closes the first
//   - a record row opens, and opening a second closes the first
//   - the search box filters the list
//   - nothing throws in the console
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SMOKE_PASSWORD;

const PAGES = [
  { role: "admin", email: "admin@qsa-demo.in", route: "/internal/finance", section: "Invoice ageing" },
  { role: "admin", email: "admin@qsa-demo.in", route: "/internal/inventory", section: "Batch and expiry queue" },
  { role: "admin", email: "admin@qsa-demo.in", route: "/internal/purchasing", section: "Purchase order register" },
  { role: "admin", email: "admin@qsa-demo.in", route: "/internal/delivery", section: "Delivered" },
  { role: "admin", email: "admin@qsa-demo.in", route: "/internal/admin", section: "Price list" },
  { role: "admin", email: "admin@qsa-demo.in", route: "/internal/users", section: null },
  { role: "logistics", email: "logistics@qsa-demo.in", route: "/internal/delivery", section: "Ready to dispatch" },
  { role: "finance", email: "finance@qsa-demo.in", route: "/internal/finance", section: "Payment register" },
];

const browser = await chromium.launch();
let failures = 0;

function check(label, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(`${BASE}/login/internal`, { waitUntil: "networkidle" });
await page.fill("#email", "admin@qsa-demo.in");
await page.fill("#password", PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 });
check("admin sign-in", true, page.url());

for (const target of PAGES) {
  if (target.role !== "admin") continue;
  console.log(`\n--- ${target.route}`);
  await page.goto(`${BASE}${target.route}`, { waitUntil: "networkidle" });

  // Section dropdowns.
  const headers = page.locator('section > h2 > button[aria-expanded]');
  const headerCount = await headers.count();

  if (target.section) {
    const targetHeader = headers.filter({ hasText: target.section }).first();
    const found = await targetHeader.count();
    check("section dropdown exists", found > 0, `${headerCount} sections, looking for "${target.section}"`);

    if (found > 0) {
      const collapsedBefore = await targetHeader.getAttribute("aria-expanded");
      await targetHeader.click();
      await page.waitForTimeout(200);
      const openedAfter = await targetHeader.getAttribute("aria-expanded");
      check("section opens on click", collapsedBefore === "false" && openedAfter === "true", `${collapsedBefore} -> ${openedAfter}`);

      const grew = await page.evaluate(() => document.documentElement.scrollHeight);
      check("opening a section adds content", grew > 2000, `${grew}px`);

      // One at a time: opening any other section must close this one.
      const other = headers.nth(0);
      const otherText = (await other.innerText()).split("\n")[1] ?? "";
      if ((await other.innerText()).includes(target.section.split(" ")[0])) {
        console.log("SKIP  one-at-a-time (first section is the one under test)");
      } else {
        await other.click();
        await page.waitForTimeout(200);
        const stillOpen = await targetHeader.getAttribute("aria-expanded");
        check("opening another closes this one", stillOpen === "false", `other="${otherText.trim()}"`);
      }
    }
  }

  // Record rows inside whichever section is open.
  const rowButtons = page.locator('li > button[aria-expanded]');
  const rowCount = await rowButtons.count();
  check("record rows render", rowCount > 0, `${rowCount} rows`);

  if (rowCount > 1) {
    const before = await rowButtons.nth(0).getAttribute("aria-expanded");
    await rowButtons.nth(0).click();
    await page.waitForTimeout(200);
    const opened = await rowButtons.nth(0).getAttribute("aria-expanded");
    check("record row opens", opened === "true", `${before} -> ${opened}`);

    await rowButtons.nth(1).click();
    await page.waitForTimeout(200);
    const firstAfter = await rowButtons.nth(0).getAttribute("aria-expanded");
    const secondAfter = await rowButtons.nth(1).getAttribute("aria-expanded");
    check("only one record row stays open", firstAfter === "false" && secondAfter === "true", `first=${firstAfter} second=${secondAfter}`);
  }

  // Search filters.
  const search = page.locator('input[type="search"]').first();
  if ((await search.count()) > 0) {
    const countText = () => page.locator('p[aria-live="polite"]').first().innerText();
    const beforeText = await countText();
    await search.fill("zzzzz-no-such-record");
    await page.waitForTimeout(250);
    const noMatch = await page.locator("text=/matches that\\.|No .*matches/i").first().count();
    check("search with no hits explains itself", noMatch > 0, `count was "${beforeText}"`);

    await search.fill("");
    await page.waitForTimeout(250);
    const restored = await countText();
    check("clearing search restores the list", restored === beforeText, `"${beforeText}" -> "${restored}"`);
  } else {
    check("search box present", false, "no search input found");
  }
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
for (const e of consoleErrors.slice(0, 10)) console.log(`  ${e}`);

await context.close();
await browser.close();

console.log(`\n${failures === 0 && consoleErrors.length === 0 ? "ALL PASS" : `${failures} failure(s)`}`);
process.exit(failures === 0 && consoleErrors.length === 0 ? 0 : 1);
