import { MODULES } from "./modules-config";

export type KBEntry = {
  id: string;
  title: string;
  keywords: string[];
  answer: string;
  route: string;
  open?: string;
};

// Auto-generate KB entries for every module in the modules hub
const MODULE_ENTRIES: KBEntry[] = MODULES.map((m) => ({
  id: "mod-" + m.slug,
  title: m.title,
  keywords: [m.title.toLowerCase(), m.slug.replace(/-/g, " "), ...m.title.toLowerCase().split(/\s+/)],
  answer: `Open Modules hub → ${m.title}. View the register and create new records there. Endpoint: ${m.endpoint}.`,
  route: `/internal/modules/${m.slug}`,
}));

const HANDWRITTEN_KB: KBEntry[] = [
  { id: "product", title: "Create a product", keywords: ["product", "add product", "new product", "create product", "sku", "catalogue"], answer: "Open Admin → Product catalogue → 'Create a product'. Fill SKU, name, category, unit, price, HSN, threshold, sellable/active. Then submit.", route: "/internal/admin", open: "create-product" },
  { id: "dealer", title: "Create a dealer", keywords: ["dealer", "add dealer", "new dealer", "create dealer"], answer: "Open Admin → Dealer master → 'Create a dealer', or use Dealer onboarding for the full flow. Fill name, region (required), contact, credit limit, status.", route: "/internal/admin", open: "create-dealer" },
  { id: "price", title: "Create a price list", keywords: ["price", "price list", "pricing", "set price"], answer: "Open Admin → Price list → 'Create a price'. Pick product, optional dealer, tier, price, validity window.", route: "/internal/admin", open: "create-price" },
  { id: "user", title: "Create a user / staff login", keywords: ["user", "staff", "login", "account", "create user", "add staff"], answer: "Open Internal → Users. Create staff with name, email, role, password. Dealer logins are created from Dealer onboarding.", route: "/internal/users" },
  { id: "designation", title: "Manage designations", keywords: ["designation", "job title", "title", "designations"], answer: "Open Internal → Designations. Add/edit job titles used in the org chart and user profiles.", route: "/internal/designations" },
  { id: "department", title: "Manage departments", keywords: ["department", "departments", "dept"], answer: "Open Internal → Departments. Add/edit departments used across the ERP.", route: "/internal/departments" },
  { id: "onboarding", title: "Onboard a dealer", keywords: ["onboard", "onboarding", "new dealer onboarding", "bring dealer"], answer: "Open Internal → Dealer onboarding → 'Start an onboarding'. Fill dealer details, record credit decision, provision login, map rep, then activate.", route: "/internal/admin/dealers" },
  { id: "org", title: "Organization chart", keywords: ["org", "organization", "org chart", "reporting", "hierarchy", "people"], answer: "Open Internal → Organization. Create positions and set reporting lines between staff.", route: "/internal/org-chart" },
  { id: "finance-settings", title: "Finance settings", keywords: ["finance settings", "gst", "ageing", "credit settings", "threshold"], answer: "Open Internal → Settings → Ageing and credit settings. Configure GST rate, company state, ageing buckets, grace days.", route: "/internal/settings", open: "settings" },
  { id: "expense", title: "Record an expense", keywords: ["expense", "spend", "cost", "record expense"], answer: "Open Finance → 'Record an expense'. Pick head, date, amount, mode, reference, notes.", route: "/internal/finance", open: "expense-entry" },
  { id: "expense-head", title: "Expense heads", keywords: ["expense head", "expense category", "head"], answer: "Open Finance → 'Expense heads'. Add/retire heads like Rent, Travel, Utilities.", route: "/internal/finance", open: "expense-heads" },
  { id: "tally", title: "Tally export", keywords: ["tally", "export", "csv", "download tally"], answer: "Open Finance or Settings → 'Download Tally CSV'. Select period and download. Export is audited in tally_exports.", route: "/internal/finance" },
  { id: "order-proxy", title: "Proxy order", keywords: ["proxy", "proxy order", "order on behalf", "place order for dealer"], answer: "Open Sales → Orders → 'Proxy order'. Select dealer and product lines. Only reps/admins can raise proxy orders.", route: "/sales/orders" },
  { id: "order-manual", title: "Manual sales order", keywords: ["manual order", "manual sales order", "create order manually"], answer: "Open Sales → Orders → 'Manual sales order'. Pick dealer, status, delivery date, product lines with prices.", route: "/sales/orders" },
  { id: "order-approve", title: "Approve / escalate order", keywords: ["approve", "approval", "escalate", "director", "order action"], answer: "Open Sales → Orders, open an order, use action buttons: Approve, Escalate, Director approve/reject, Dispatch.", route: "/sales/orders" },
  { id: "order-edit", title: "Edit order", keywords: ["edit order", "modify order", "change order lines"], answer: "Open Sales → Orders, open a pending order, use the edit form to change lines (before approval).", route: "/sales/orders" },
  { id: "invoice-generate", title: "Generate invoice", keywords: ["invoice", "generate invoice", "create invoice", "billing"], answer: "Finance → 'Invoice queue' lists dispatched orders; click 'Generate invoice'. Or use 'Manual invoice' panel for dealer-tagged invoices.", route: "/internal/finance", open: "queue" },
  { id: "invoice-manual", title: "Manual invoice", keywords: ["manual invoice", "invoice manually", "create invoice manually"], answer: "Open Finance → 'Manual invoice'. Select dealer, enter taxable/GST/total, submit.", route: "/internal/finance", open: "manual-invoice" },
  { id: "payment", title: "Record payment", keywords: ["payment", "record payment", "receipt", "pay"], answer: "Finance → 'Invoice register' → open invoice → record payment (partial/full). Or 'Dealer account payments' for advance receipts.", route: "/internal/finance", open: "register" },
  { id: "credit", title: "Dealer credit", keywords: ["credit", "credit limit", "dealer credit", "exposure"], answer: "Finance → 'Dealer credit and region' to edit limits/regions. 'Dealer credit exposure' shows usage.", route: "/internal/finance", open: "dealer-credit" },
  { id: "production-run", title: "Production run", keywords: ["production", "production run", "manufacture", "create run", "output"], answer: "Internal → Production → create run: finished product, quantity, shift, raw materials, QC status/notes.", route: "/internal/production" },
  { id: "qc", title: "QC verdict", keywords: ["qc", "quality", "pass", "fail", "hold", "verdict"], answer: "Internal → Quality: select a pending run and record pass/hold/fail (notes required on fail).", route: "/internal/quality" },
  { id: "stock-adjust", title: "Stock adjustment", keywords: ["stock", "adjustment", "inventory adjust", "stock in", "stock out"], answer: "Internal → Inventory → 'Record adjustment': product, in/out, quantity, reason.", route: "/internal/inventory", open: "adjust" },
  { id: "batch-receive", title: "Batch receive", keywords: ["batch", "receive batch", "expiry", "lot"], answer: "Internal → Inventory → 'Receive into batch': product, batch code, manufacture/expiry dates, quantity.", route: "/internal/inventory", open: "receive" },
  { id: "purchase-invoice", title: "Purchase invoice (supplier bill)", keywords: ["purchase invoice", "supplier bill", "supplier invoice", "raw material bill", "bill"], answer: "Internal → Purchasing → 'Record purchase invoice': supplier, invoice number, amounts, product lines. Can link to a PO.", route: "/internal/purchasing", open: "invoice" },
  { id: "po-receive", title: "Receive PO", keywords: ["receive po", "receive purchase order", "grn"], answer: "Open a PO and enter received quantities per line; status moves to partial/received.", route: "/internal/purchasing", open: "receive" },
  { id: "dispatch", title: "Dispatch", keywords: ["dispatch", "dispatch queue", "ready to dispatch"], answer: "Internal → Dispatch queue: approved orders ready; mark dispatched with date & tracking note.", route: "/internal/orders" },
  { id: "delivery", title: "Delivery confirm", keywords: ["delivery", "deliver", "confirm delivery", "tracking"], answer: "Internal → Delivery board: set dispatch details and confirm delivery.", route: "/internal/delivery", open: "confirm" },
  { id: "dealer-catalog", title: "Dealer catalog", keywords: ["catalog", "catalogue", "products list", "dealer catalog"], answer: "Dealers: /dealer/catalog shows available products and prices.", route: "/dealer/catalog" },
  { id: "dealer-orders", title: "Dealer orders", keywords: ["dealer order", "place order", "my orders"], answer: "Dealers: /dealer/orders to place and track orders.", route: "/dealer/orders" },
  { id: "reports", title: "Reporting", keywords: ["report", "sales report", "regional", "reporting"], answer: "Sales → Reporting for regional sales, rep coverage, dealer exposure.", route: "/sales/reports" },
  { id: "settings", title: "Settings", keywords: ["settings", "configuration", "config"], answer: "Internal → Settings: ageing/credit settings, Tally export, portal quick links.", route: "/internal/settings" },
  { id: "payslip", title: "Salary slip", keywords: ["salary slip", "payslip", "pay slip", "salary"], answer: "Internal → Payroll → open a run → 'View / generate' → 'Generate salary slips'. View slips on /internal/payslips.", route: "/internal/payslips" },
  { id: "employee-onboarding", title: "Employee onboarding", keywords: ["employee onboarding", "onboard employee", "hr onboarding", "aadhaar", "pan", "bank details"], answer: "Internal → Employees → 'Onboard employee'. Fill personal, identity, bank, address, employment details, upload photo/documents.", route: "/internal/employees" },
  { id: "audit-log", title: "Audit log", keywords: ["audit", "audit log", "activity log", "trail"], answer: "Internal → Audit log shows recent actions (logins, invoices, expenses, orders).", route: "/internal/audit" },
  { id: "help", title: "Help topics", keywords: ["help", "topics", "list", "what can you do"], answer: "I can guide you on products, dealers, users, price lists, orders, invoices, payments, credit, expenses, production, QC, stock, batches, purchase orders, dispatch, delivery, onboarding, org chart, settings, reports, and all 70+ modules in the Modules hub. Ask 'how to ...' or click a topic.", route: "/internal" },
];

// Merge: hand-written entries take precedence over auto-generated module entries (by id)
const KB: KBEntry[] = [...HANDWRITTEN_KB, ...MODULE_ENTRIES.filter((m) => !HANDWRITTEN_KB.some((h) => h.id === m.id))];

export function searchKB(q: string): KBEntry | null {
  const lower = q.toLowerCase().trim();
  if (!lower) return null;
  if (lower === "help" || lower === "topics" || lower === "list") {
    return KB.find((e) => e.id === "help") || null;
  }
  let best: { entry: KBEntry; score: number } | null = null;
  for (const e of KB) {
    let score = 0;
    for (const kw of e.keywords) {
      if (lower.includes(kw)) score += kw.length + 5;
    }
    for (const w of e.title.toLowerCase().split(/\s+/)) {
      if (w.length > 2 && lower.includes(w)) score += 2;
    }
    if (score > 0 && (!best || score > best.score)) best = { entry: e, score };
  }
  return best ? best.entry : null;
}
