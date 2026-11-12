import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";

const imgDir = "C:\\Users\\syedm\\AppData\\Local\\Temp\\opencode\\screens";
const tmpDir = "C:\\Users\\syedm\\AppData\\Local\\Temp\\opencode\\workflow";
if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

function b64(name) {
  const buf = readFileSync(join(imgDir, name));
  return "data:image/png;base64," + buf.toString("base64");
}

const I = {
  overview: b64("01-overview.png"),
  inventory: b64("02-inventory.png"),
  purchasing: b64("03-purchasing.png"),
  production: b64("04-production.png"),
  quality: b64("05-quality.png"),
  finance: b64("06-finance.png"),
  orders: b64("07-orders.png"),
  delivery: b64("08-delivery.png"),
  orgchart: b64("09-orgchart.png"),
  login: b64("10-login.png"),
  settings: b64("11-settings.png"),
  sales: b64("12-sales.png"),
  salesorders: b64("13-sales-orders.png"),
  dealer: b64("14-dealer.png"),
};

const css = `
  body { font-family: "Segoe UI", Arial, sans-serif; margin: 32px; color: #27312d; line-height: 1.6; font-size: 12px; }
  h1 { color: #25311f; border-bottom: 3px solid #baff48; padding-bottom: 8px; font-size: 24px; }
  h2 { color: #6f8c3b; margin-top: 28px; font-size: 18px; border-left: 4px solid #baff48; padding-left: 10px; }
  h3 { color: #27312d; margin-top: 16px; font-size: 14px; }
  p { margin: 8px 0; }
  ul, ol { padding-left: 22px; margin: 8px 0; }
  li { margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 11px; }
  th, td { border: 1px solid #dfe6dc; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f2f3ed; }
  .shot { margin: 12px 0; text-align: center; }
  .shot img { max-width: 100%; border: 1px solid #dfe6dc; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
  .shot cap { display: block; font-size: 10px; color: #718075; margin-top: 4px; font-style: italic; }
  .callout { background: #fff7df; border-left: 4px solid #e0a33e; padding: 10px 14px; margin: 12px 0; font-size: 11px; }
  .hero { background: linear-gradient(135deg, #baff48, #eaf3d8); padding: 20px; border-radius: 12px; margin: 16px 0; }
  code { background: #f2f3ed; padding: 1px 4px; border-radius: 3px; font-size: 10px; }
  .page-break { page-break-before: always; }
`;

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>QSA ERP — Complete Workflow Guide</title>
<style>${css}</style></head><body>

<h1>QSA Industries ERP — Complete Workflow Guide</h1>
<p class="hero"><strong>From setup to daily operations.</strong> This document explains how to set up the ERP, what data goes where, how every department works, and the full chain of execution for an order — from the moment a dealer places it to delivery, invoicing and payment. Screenshots are included throughout.</p>

<h2>1. Setup</h2>
<h3>Prerequisites</h3>
<ul>
  <li>XAMPP at <code>C:\\xampp</code> (MariaDB 10.11 + Apache + phpMyAdmin).</li>
  <li>Node.js v26+.</li>
  <li>Project at <code>D:\\PROJECTS+\\QSAINDUSTRIES\\QSAINDUSTRIES</code>.</li>
</ul>
<h3>Start services</h3>
<pre>Start-Process -FilePath "C:\\xampp\\mysql\\bin\\mysqld.exe" -ArgumentList "--defaults-file=C:\\xampp\\mysql\\bin\\my.ini" -WindowStyle Hidden
Start-Process -FilePath "C:\\xampp\\apache\\bin\\httpd.exe" -WindowStyle Hidden</pre>
<h3>Start app</h3>
<pre>cd D:\\PROJECTS+\\QSAINDUSTRIES\\QSAINDUSTRIES\\web
npm run dev</pre>
<p>App: <code>http://localhost:3000</code> &nbsp;|&nbsp; Login: <code>http://localhost:3000/login</code> &nbsp;|&nbsp; phpMyAdmin: <code>http://localhost/phpmyadmin</code></p>
<h3>Credentials</h3>
<table>
  <tr><th>Account</th><th>Email</th><th>Password</th></tr>
  <tr><td>Admin</td><td>admin@qsa-demo.in</td><td>Qsa@Demo2026</td></tr>
  <tr><td>Finance</td><td>finance@qsa-demo.in</td><td>Qsa@Demo2026</td></tr>
  <tr><td>Sales Director</td><td>nadia.kapoor@qsa-demo.in</td><td>Qsa@Demo2026</td></tr>
  <tr><td>Production</td><td>operations.production@qsa-demo.in</td><td>Qsa@Demo2026</td></tr>
  <tr><td>Inventory</td><td>operations.inventory@qsa-demo.in</td><td>Qsa@Demo2026</td></tr>
  <tr><td>QC</td><td>qc@qsa-demo.in</td><td>Qsa@Demo2026</td></tr>
  <tr><td>Logistics</td><td>logistics@qsa-demo.in</td><td>Qsa@Demo2026</td></tr>
  <tr><td>Dealer</td><td>dealer@qsa-demo.in</td><td>Qsa@Demo2026</td></tr>
</table>
<p>MySQL: host <code>localhost:3306</code>, database <code>qsa_erp</code>, user <code>qsa_user</code> / <code>Qsa@Demo2026</code>.</p>

<div class="shot"><img src="${I.login}" /><span class="cap">Login screen — choose Internal / Sales / Dealer portal.</span></div>

<h2>2. Architecture (local mode)</h2>
<ul>
  <li><code>web/src/lib/db.ts</code> — mysql2 pool (env MYSQL_HOST/PORT/USER/PASSWORD/DATABASE).</li>
  <li><code>web/src/lib/auth.ts</code> — cookie session <code>qsa_session</code> (HMAC-signed), <code>getProfile()</code> reads <code>users</code> table.</li>
  <li><code>web/src/app/api/auth/login|logout</code> — bcrypt verify + cookie set/clear.</li>
  <li><code>web/src/lib/database/*</code> — shims returning empty data for unmigrated reads (non-crashing).</li>
  <li><code>web/src/proxy.ts</code> — CSRF Origin check + global rate limit (10 req/min/IP).</li>
  <li>Each module has dedicated routes under <code>web/src/app/api/...</code>.</li>
</ul>

<h2>3. User roles</h2>
<table>
  <tr><th>Role</th><th>Portal</th><th>Scope</th></tr>
  <tr><td>admin</td><td>Internal</td><td>Full access; superuser passes every guard.</td></tr>
  <tr><td>sales_director / sales_manager</td><td>Sales</td><td>Approve/escalate orders, view reports.</td></tr>
  <tr><td>sales_rep</td><td>Sales</td><td>Raise proxy orders for mapped dealers, edit pending orders.</td></tr>
  <tr><td>finance</td><td>Internal</td><td>Invoices, payments, expenses, credit, Tally export.</td></tr>
  <tr><td>production_manager</td><td>Internal</td><td>Production runs, QC.</td></tr>
  <tr><td>inventory_manager</td><td>Internal</td><td>Stock, adjustments, purchase orders.</td></tr>
  <tr><td>qc_staff</td><td>Internal</td><td>QC verdicts.</td></tr>
  <tr><td>logistics</td><td>Internal</td><td>Dispatch &amp; delivery.</td></tr>
  <tr><td>dealer</td><td>Dealer</td><td>Catalog, own orders, own invoices.</td></tr>
</table>

<h2>4. Database (core tables)</h2>
<p><code>users, dealers, products, price_lists, orders, order_items, invoices, payments, stock_levels, stock_movements, production_runs, production_batches, purchase_orders, purchase_order_lines, finance_settings, expense_heads, expense_ledger, designations, org_positions, dealer_onboardings, tally_exports.</code></p>
<p><code>users.password_hash</code> holds bcrypt hashes; <code>users.reports_to_id</code> drives the org chart.</p>

<h2>5. Navigation &amp; UI</h2>
<p>Sidebar order: Overview, Inventory, Purchasing, Production, Quality, Finance, Dispatch queue, Delivery board, Organization, Dealer onboarding, Sales orders, Reporting, Settings.</p>
<div class="shot"><img src="${I.overview}" /><span class="cap">Internal overview — KPI hero, charts, order board.</span></div>

<h2>6. Department workflows</h2>

<h3>6.1 Admin</h3>
<p>Products, dealers, users, designations, price lists, settings, dealer onboarding, org chart. Admin is the only role that can create master data.</p>
<div class="shot"><img src="${I.settings}" /><span class="cap">Settings page — ageing/credit, Tally export, portal quick links.</span></div>

<h3>6.2 Sales</h3>
<p>Sales reps manage dealers mapped to them, raise proxy orders, approve/escalate orders. Sales managers/directors approve escalated orders.</p>
<div class="shot"><img src="${I.sales}" /><span class="cap">Sales dashboard.</span></div>
<div class="shot"><img src="${I.salesorders}" /><span class="cap">Sales orders — queue, proxy order form, edit.</span></div>

<h3>6.3 Finance</h3>
<p>Generate invoices, record payments, manage dealer credit, record expenses, export to Tally, configure ageing/credit settings.</p>
<div class="shot"><img src="${I.finance}" /><span class="cap">Finance page — invoices, payments, expenses, exposure.</span></div>

<h3>6.4 Production</h3>
<p>Create production runs (finished goods from raw materials), QC verdicts, batch tracking with expiry.</p>
<div class="shot"><img src="${I.production}" /><span class="cap">Production page.</span></div>

<h3>6.5 Quality</h3>
<p>QC staff record pass/hold/fail on pending runs.</p>
<div class="shot"><img src="${I.quality}" /><span class="cap">Quality page.</span></div>

<h3>6.6 Inventory</h3>
<p>Stock levels, adjustments, batch receive, low-stock &amp; dead-stock signals.</p>
<div class="shot"><img src="${I.inventory}" /><span class="cap">Inventory page.</span></div>

<h3>6.7 Purchasing</h3>
<p>Purchase orders for raw materials, receiving, supplier tracking.</p>
<div class="shot"><img src="${I.purchasing}" /><span class="cap">Purchasing page.</span></div>

<h3>6.8 Logistics</h3>
<p>Dispatch queue and delivery board: mark dispatched, record tracking, confirm delivery.</p>
<div class="shot"><img src="${I.delivery}" /><span class="cap">Delivery board.</span></div>

<h3>6.9 Organization</h3>
<p>Org chart and people builder: positions, reporting lines, designations.</p>
<div class="shot"><img src="${I.orgchart}" /><span class="cap">Organization chart.</span></div>

<h3>6.10 Dealer portal</h3>
<p>Dealers browse catalog, place orders, view invoices and delivery status.</p>
<div class="shot"><img src="${I.dealer}" /><span class="cap">Dealer portal.</span></div>

<h2 class="page-break">7. Order lifecycle — chain of execution</h2>
<p>An order flows through these states. Each transition is a deliberate action by a specific role.</p>
<table>
  <tr><th>State</th><th>Who acts</th><th>What happens</th></tr>
  <tr><td>pending</td><td>Dealer / Sales rep (proxy)</td><td>Order created with lines, stock checked, price resolved. Status pending.</td></tr>
  <tr><td>approved</td><td>Sales manager / admin</td><td>Approve if within credit limit. Moves to dispatch queue.</td></tr>
  <tr><td>pending_director_approval</td><td>Sales rep escalates</td><td>Order exceeds approval limit; escalated to director.</td></tr>
  <tr><td>director_approved / rejected</td><td>Sales director</td><td>Director approves or rejects escalated order.</td></tr>
  <tr><td>dispatched</td><td>Logistics</td><td>Mark dispatched with date and tracking note.</td></tr>
  <tr><td>invoiced</td><td>Finance</td><td>Generate invoice (taxable + 5% GST). Order marked invoiced.</td></tr>
  <tr><td>delivered</td><td>Logistics</td><td>Confirm delivery.</td></tr>
  <tr><td>cancelled</td><td>Admin / Sales</td><td>Cancel an order.</td></tr>
</table>

<h3>Path A — Happy path (dealer places order)</h3>
<ol>
  <li>Dealer logs in → catalog → selects products &amp; quantities → places order (status <strong>pending</strong>).</li>
  <li>Sales rep/manager opens Sales → Orders → reviews lines &amp; credit exposure.</li>
  <li>If within approval limit: <strong>Approve</strong> → status <strong>approved</strong> → appears in Dispatch queue.</li>
  <li>Logistics marks <strong>Dispatched</strong> (date + tracking note).</li>
  <li>Finance generates <strong>Invoice</strong> → status <strong>invoiced</strong> (taxable + 5% GST).</li>
  <li>Logistics confirms <strong>Delivered</strong>.</li>
  <li>Finance records <strong>Payment</strong> (partial or full) against the invoice.</li>
</ol>

<h3>Path B — Proxy order (sales rep on behalf of dealer)</h3>
<ol>
  <li>Sales rep/admin opens Sales → Orders → "Proxy order" panel.</li>
  <li>Selects dealer (must be mapped to the rep; admin can pick any active dealer) and product lines.</li>
  <li>Submits → order created as <strong>pending</strong> with stock &amp; price validated.</li>
  <li>Continues from step 2 of Path A.</li>
</ol>

<h3>Path C — Manual sales order</h3>
<ol>
  <li>Sales/Admin opens Sales → Orders → "Manual sales order" panel.</li>
  <li>Picks an existing dealer, status, delivery date, product lines with custom prices.</li>
  <li>Submits → order created tagged to the dealer (status as chosen).</li>
</ol>

<h3>Path D — Credit issue (order stuck)</h3>
<ol>
  <li>Order exceeds the dealer's credit limit or approval threshold.</li>
  <li>Sales rep clicks <strong>Escalate</strong> → status <strong>pending_director_approval</strong>.</li>
  <li>Sales director reviews credit exposure and either <strong>Approves</strong> (→ approved) or <strong>Rejects</strong>.</li>
  <li>Alternatively, admin sets a credit override on the dealer, then approves.</li>
  <li>If credit was refused at onboarding, the dealer cannot trade until credit is approved.</li>
</ol>

<h3>Path E — Manual invoice (no order)</h3>
<ol>
  <li>Finance opens Finance → "Manual invoice" panel.</li>
  <li>Selects dealer, enters taxable/GST/total amounts (optional invoice number &amp; date).</li>
  <li>Invoice created tagged to the dealer (order_id is null) and appears in the register &amp; Tally export.</li>
</ol>

<h3>Stuck / edge cases</h3>
<ul>
  <li><strong>No sales rep mapped</strong> → dealer cannot be activated during onboarding; orders blocked.</li>
  <li><strong>Inactive dealer</strong> → cannot place orders.</li>
  <li><strong>Insufficient stock</strong> → order creation refused.</li>
  <li><strong>Low stock / dead stock</strong> → flagged on overview, not blocking.</li>
  <li><strong>QC fail/hold</strong> → production run produces nothing; not counted in yield.</li>
  <li><strong>Voided expense</strong> → stays in register struck through; net totals exclude it.</li>
</ul>

<h2 class="page-break">8. Data entry — where to put what</h2>
<p>Each data-entry screen has a <strong>PDF Help</strong> link (top-right of the form) opening a detailed guide in <code>/guides/</code>. Summary of where data is entered:</p>
<table>
  <tr><th>Data</th><th>Where</th><th>Role</th></tr>
  <tr><td>Products</td><td>Admin → Product catalogue / Create a product</td><td>admin</td></tr>
  <tr><td>Dealers</td><td>Admin → Dealer master / Create a dealer (or Dealer onboarding)</td><td>admin</td></tr>
  <tr><td>Users / staff logins</td><td>Internal → Users</td><td>admin</td></tr>
  <tr><td>Price lists</td><td>Admin → Price list / Create a price</td><td>admin</td></tr>
  <tr><td>Designations</td><td>Admin → Designations manager</td><td>admin</td></tr>
  <tr><td>Org chart / people</td><td>Internal → Organization</td><td>admin</td></tr>
  <tr><td>Finance settings</td><td>Internal → Settings</td><td>admin/finance</td></tr>
  <tr><td>Expense heads</td><td>Finance → Expense heads</td><td>admin/finance</td></tr>
  <tr><td>Expenses</td><td>Finance → Record an expense</td><td>admin/finance</td></tr>
  <tr><td>Sales orders (dealer)</td><td>Dealer portal → Orders</td><td>dealer</td></tr>
  <tr><td>Sales orders (proxy)</td><td>Sales → Orders → Proxy order</td><td>sales_rep/admin</td></tr>
  <tr><td>Sales orders (manual)</td><td>Sales → Orders → Manual sales order</td><td>sales_rep/admin</td></tr>
  <tr><td>Order approval/escalation/dispatch</td><td>Sales → Orders (open an order)</td><td>sales_manager/director/logistics</td></tr>
  <tr><td>Invoices</td><td>Finance → Invoice queue → Generate invoice; or Manual invoice</td><td>finance/admin</td></tr>
  <tr><td>Payments</td><td>Finance → Invoice register / Dealer account payments</td><td>finance/admin</td></tr>
  <tr><td>Dealer credit</td><td>Finance → Dealer credit and region</td><td>admin/finance</td></tr>
  <tr><td>Production runs</td><td>Internal → Production → create run</td><td>production_manager/admin</td></tr>
  <tr><td>QC verdicts</td><td>Internal → Quality</td><td>qc_staff/production_manager</td></tr>
  <tr><td>Stock adjustments</td><td>Internal → Inventory → stock adjustment</td><td>inventory/production/admin</td></tr>
  <tr><td>Batch receive</td><td>Internal → Inventory → batch receive</td><td>inventory/admin</td></tr>
  <tr><td>Purchase orders</td><td>Internal → Purchasing → create PO</td><td>inventory/production/admin</td></tr>
  <tr><td>PO receive</td><td>Purchasing → receive against PO</td><td>inventory/admin</td></tr>
  <tr><td>Delivery confirm</td><td>Internal → Delivery board</td><td>logistics/admin</td></tr>
  <tr><td>Dealer onboarding</td><td>Internal → Dealer onboarding</td><td>admin</td></tr>
  <tr><td>Tally export</td><td>Finance → Download Tally CSV / Settings</td><td>finance/admin</td></tr>
</table>

<h2>9. Troubleshooting</h2>
<ul>
  <li><strong>MySQL not running:</strong> start mysqld via XAMPP; app needs DB before <code>npm run dev</code>.</li>
  <li><strong>"Objects are not valid as a React child (Date)":</strong> ensure <code>dateStrings: true</code> in <code>db.ts</code>.</li>
  <li><strong>Access denied for qsa_user:</strong> recreate via <code>mysql -u root &lt; user2.sql</code>.</li>
  <li><strong>Empty analytics screens:</strong> views not yet ported to MySQL (remaining gap).</li>
  <li><strong>403 Forbidden:</strong> role not allowed for that route.</li>
  <li><strong>429 Too Many Requests:</strong> rate limit (10 req/min/IP) exceeded.</li>
</ul>

<p style="margin-top:40px; color:#819083; font-size:10px;">QSA Industries ERP — Complete Workflow Guide. Generated for local MySQL build.</p>

</body></html>`;

const htmlPath = join(tmpDir, "workflow.html");
writeFileSync(htmlPath, html, "utf8");
const pdfPath = join(process.cwd(), "..", "docs", "QSA-ERP-Complete-Workflow-Guide.pdf");
execFileSync("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", [
  "--headless", "--disable-gpu",
  `--print-to-pdf=${pdfPath}`,
  `file:///${htmlPath.replace(/\\/g, "/")}`,
], { stdio: "ignore", timeout: 300000 });
console.log("generated", pdfPath);

