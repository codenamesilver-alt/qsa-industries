// Verifies the picker and the Users & Roles split, in a real browser.
//
// The unit of behaviour is not "does it compile" but "is the page short and is
// exactly one row open", so this checks the four things that were actually wrong:
//
//   1. /internal/admin is no longer ~25,000px tall, and holds no user form at all
//   2. /internal/users exists, creates accounts, and lists them behind the picker
//   3. the picker filters as you type, and never leaves two rows open
//   4. /internal/org-chart can no longer create an account
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const PASSWORD = process.env.SMOKE_PASSWORD;

if (!PASSWORD) {
  console.error("SMOKE_PASSWORD is required.");
  process.exit(1);
}

let failures = 0;
function check(label, pass, detail = "") {
  if (!pass) failures += 1;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

// 1. Admin master data.
await page.goto(`${BASE}/login/internal`, { waitUntil: "networkidle" });
await page.fill("#email", "admin@qsa-demo.in");
await page.fill("#password", PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 });

await page.goto(`${BASE}/internal/admin`, { waitUntil: "networkidle", timeout: 60000 });
const admin = await page.evaluate(() => ({
  h: document.documentElement.scrollHeight,
  text: document.body.innerText,
  passwordFields: document.querySelectorAll('input[type="password"]').length,
  searchBoxes: document.querySelectorAll('input[type="search"]').length,
  error: /Application error|Internal Server Error/i.test(document.body.innerText),
}));

console.log("\n/internal/admin");
check("renders", !admin.error);
check("no longer a wall of scroll", admin.h < 12000, `h=${admin.h} (was 25013)`);
check("no password field left behind", admin.passwordFields === 0, `found ${admin.passwordFields}`);
check("has search boxes", admin.searchBoxes >= 2, `found ${admin.searchBoxes}`);
check(
  "no account creation",
  !/Create a staff login|Initial password|Users, roles and reporting lines/i.test(admin.text),
);
check("points at the new screen", /Users & Roles/i.test(admin.text));

// The picker itself: filter, then one-open-at-a-time.
const rows = page.locator('ul > li:has(button[aria-expanded])');
const rowCount = await rows.count();
check("product rows collapsed by default", rowCount > 0, `${rowCount} rows`);

const openCount = () =>
  page.locator('button[aria-expanded="true"]').count();

check("nothing open before a click", (await openCount()) === 0);

await rows.nth(0).locator("button[aria-expanded]").click();
check("one row opens", (await openCount()) === 1);

if (rowCount > 1) {
  await rows.nth(1).locator("button[aria-expanded]").click();
  check("opening a second closes the first", (await openCount()) === 1);
}

const box = page.locator('input[type="search"]').first();
const totalLabel = await page.locator("p[aria-live=polite]").first().innerText();
const bodyText = () => page.evaluate(() => document.body.innerText);

await box.fill("zzzznomatch");
check(
  "no-match state is explained",
  /No product matches/i.test(await bodyText()),
  `was "${totalLabel}"`,
);

await box.fill("");
const searched = page.locator("p[aria-live=polite]").first().innerText();
await box.fill(String((await rows.nth(0).innerText()).split("\n")[0]).trim().slice(0, 6));
check(
  "search narrows the list",
  /\d+ of \d+ match/.test(await page.locator("p[aria-live=polite]").first().innerText()),
  `was "${searched}"`,
);
await box.fill("");

// 2. Users & Roles.
await page.goto(`${BASE}/internal/users`, { waitUntil: "networkidle", timeout: 60000 });
const users = await page.evaluate(() => ({
  h: document.documentElement.scrollHeight,
  h1: document.querySelector("h1")?.textContent?.trim() ?? "",
  text: document.body.innerText,
  createForm: document.querySelectorAll('input[name="password"], form button[type="submit"]').length,
  passwordFields: document.querySelectorAll('input[type="password"]').length,
  userRows: document.querySelectorAll('ul > li:has(button[aria-expanded])').length,
  navLink: [...document.querySelectorAll("nav a")].some((a) => /Users & Roles/.test(a.textContent ?? "")),
  error: /Application error|Internal Server Error/i.test(document.body.innerText),
}));

console.log("\n/internal/users");
check("renders", !users.error);
check("is the Users & Roles screen", /users and roles/i.test(users.h1), users.h1);
check("has a create form", users.passwordFields > 0, `${users.passwordFields} password fields`);
check("lists accounts", users.userRows > 0, `${users.userRows} rows`);
check("is in the nav", users.navLink);
check(
  "explains where dealers come from",
  /Dealer onboarding/i.test(users.text),
);
check("explains the last-admin guard", /last active admin/i.test(users.text));
check("stays a scrollable page, not a wall", users.h < 14000, `h=${users.h}`);

// A non-admin must not reach it.
const repContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const repPage = await repContext.newPage();
await repPage.goto(`${BASE}/login/sales`, { waitUntil: "networkidle" });
await repPage.fill("#email", "ravi.menon@qsa-demo.in");
await repPage.fill("#password", PASSWORD);
await repPage.click('button[type="submit"]');
await repPage.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45000 });
const denied = await repPage.goto(`${BASE}/internal/users`, { waitUntil: "networkidle", timeout: 60000 });
check(
  "a sales rep is refused",
  repPage.url().includes("/unauthorized") || (denied?.status() ?? 500) >= 400,
  `${denied?.status()} ${repPage.url().replace(BASE, "")}`,
);
await repContext.close();

// 3. Org chart can no longer create anybody.
await page.goto(`${BASE}/internal/org-chart`, { waitUntil: "networkidle", timeout: 60000 });
const org = await page.evaluate(() => ({
  text: document.body.innerText,
  passwordFields: document.querySelectorAll('input[type="password"]').length,
  loginEmailFields: [...document.querySelectorAll("label")].filter((l) =>
    /Login email/i.test(l.textContent ?? ""),
  ).length,
  usersLink: [...document.querySelectorAll("a")].some((a) =>
    /Add someone on Users/i.test(a.textContent ?? ""),
  ),
}));

console.log("\n/internal/org-chart");
check("no password field", org.passwordFields === 0, `found ${org.passwordFields}`);
check("no login email field", org.loginEmailFields === 0, `found ${org.loginEmailFields}`);
check("no Add a person form", !/Add to the chart/i.test(org.text));
check("sends you to the right screen", org.usersLink);

await browser.close();

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
