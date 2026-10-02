import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage();
await p.goto("http://localhost:3000/login/internal", { waitUntil: "networkidle" });
await p.fill("#email", "admin@qsa-demo.in");
await p.fill("#password", "Qsa-Docs-2026!");
await p.click('button[type="submit"]');
try {
  await p.waitForURL(u => !u.pathname.startsWith("/login"), { timeout: 30000 });
  console.log("LOGIN OK ->", p.url());
} catch {
  console.log("LOGIN FAILED ->", p.url());
  console.log("body:", (await p.evaluate(() => document.body.innerText)).replace(/\s+/g," ").slice(0,300));
}
await b.close();
