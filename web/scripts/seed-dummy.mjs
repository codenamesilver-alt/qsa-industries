import mysql from "mysql2/promise";
import { randomUUID } from "crypto";

const pool = await mysql.createConnection({
  host: process.env.MYSQL_HOST || "localhost",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "qsa_user",
  password: process.env.MYSQL_PASSWORD || "Qsa@Demo2026",
  database: process.env.MYSQL_DATABASE || "qsa_erp",
  charset: "utf8mb4",
});

const q = (sql, params = []) => pool.execute(sql, params);

const uuid = () => randomUUID();

// ---------- helpers ----------
const today = new Date();
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function daysAgo(n) {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return isoDate(d);
}
function daysFrom(n) {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

// ---------- products (add a few more) ----------
const products = [
  { name: "Layer Feed 50kg", sku: "FG-001", sellable: 1, id: "30000000-0000-4000-8000-000000000001" },
  { name: "Broiler Feed 50kg", sku: "FG-002", sellable: 1, id: "30000000-0000-4000-8000-000000000002" },
  { name: "Soybean Meal", sku: "RM-001", sellable: 0, id: "30000000-0000-4000-8000-000000000003" },
  { name: "Maize", sku: "RM-002", sellable: 0, id: "30000000-0000-4000-8000-000000000004" },
];
const newProducts = [
  { name: "Cattle Feed 50kg", sku: "FG-003", sellable: 1 },
  { name: "Fish Feed 25kg", sku: "FG-004", sellable: 1 },
  { name: "Wheat Bran", sku: "RM-003", sellable: 0 },
];
for (const p of newProducts) {
  // skip if sku already exists
  const [rows] = await pool.query("SELECT id FROM products WHERE sku=?", [p.sku]);
  let id;
  if (rows.length) {
    id = rows[0].id;
  } else {
    id = uuid();
    await q("INSERT INTO products (id,name,sku,is_sellable,active) VALUES (?,?,?, ?,1)", [id, p.name, p.sku, p.sellable]);
    await q("INSERT INTO stock_levels (product_id,current_quantity) VALUES (?,?)", [id, (Math.random() * 500 + 50).toFixed(2)]);
  }
  products.push({ ...p, id });
}
console.log("products ready, total", products.length);

const sellable = products.filter((p) => p.sellable === 1);
const raw = products.filter((p) => p.sellable === 0);

// ---------- dealers (add 2 more) ----------
const dealers = [
  { id: "20000000-0000-4000-8000-000000000001", name: "GreenFields Agro", status: "active", region: "North", credit_limit: 500000 },
  { id: "20000000-0000-4000-8000-000000000002", name: "Sunrise Poultry", status: "active", region: "West", credit_limit: 350000 },
  { id: "20000000-0000-4000-8000-000000000003", name: "Coastal Agri Enterprises", status: "active", region: "South", credit_limit: 400000 },
];
const newDealers = [
  { name: "Highland Feeds", status: "active", region: "East", credit_limit: 300000 },
  { name: "Riverbend Traders", status: "active", region: "North", credit_limit: 250000 },
];
for (const d of newDealers) {
  const [rows] = await pool.query("SELECT id FROM dealers WHERE name=?", [d.name]);
  let id;
  if (rows.length) {
    id = rows[0].id;
  } else {
    id = uuid();
    await q("INSERT INTO dealers (id,name,status,region,credit_limit,created_at) VALUES (?,?,?,?,?,NOW())", [id, d.name, d.status, d.region, d.credit_limit]);
  }
  dealers.push({ ...d, id });
}

// ---------- users (sales reps) ----------
const salesRepId = "10000000-0000-4000-8000-000000000005"; // Ravi Menon
const adminId = "10000000-0000-4000-8000-000000000001";
const financeId = "22145f21-ebba-4e23-8bc5-b9650307a4ea";

// ---------- price lists ----------
for (const p of sellable) {
  await q(
    "INSERT INTO price_lists (id,product_id,price_tier,price,valid_from) VALUES (?,?,?,?,?)",
    [uuid(), p.id, "standard_dealer", (Math.random() * 400 + 900).toFixed(2), daysAgo(180)],
  );
}
console.log("price lists added");

// ---------- stock levels for existing products ----------
for (const p of products) {
  // upsert-ish: insert if missing
  try {
    await q("INSERT INTO stock_levels (product_id,current_quantity) VALUES (?,?)", [p.id, (Math.random() * 800 + 100).toFixed(2)]);
  } catch (e) {
    // ignore duplicate
  }
}

// ---------- stock movements ----------
for (let i = 0; i < 15; i++) {
  const p = products[Math.floor(Math.random() * products.length)];
  const isIn = Math.random() > 0.4;
  await q(
    "INSERT INTO stock_movements (id,product_id,quantity,movement_type,source,reason,created_at) VALUES (?,?,?,?,?,?,?)",
    [uuid(), p.id, (Math.random() * 100 + 10).toFixed(2), isIn ? "in" : "out", isIn ? "production" : "order", isIn ? "batch received" : "dispatch", daysAgo(Math.floor(Math.random() * 60)) + " 10:00:00"],
  );
}
console.log("stock movements added");

// ---------- production runs + batches ----------
const shifts = ["morning", "afternoon", "night"];
const qcStatuses = ["passed", "passed", "passed", "pending", "failed"];
for (let i = 0; i < 8; i++) {
  const p = sellable[Math.floor(Math.random() * sellable.length)];
  const runId = uuid();
  const qty = (Math.random() * 200 + 50).toFixed(2);
  const qc = qcStatuses[Math.floor(Math.random() * qcStatuses.length)];
  await q(
    "INSERT INTO production_runs (id,run_date,shift,product_id,quantity_produced,qc_status,qc_notes,created_by,created_at) VALUES (?,?,?,?,?,?,?, ?,NOW())",
    [runId, daysAgo(Math.floor(Math.random() * 90)), shifts[Math.floor(Math.random() * shifts.length)], p.id, qty, qc, qc === "failed" ? "QC failed: moisture high" : null, adminId],
  );
  // batch
  await q(
    "INSERT INTO production_batches (id,product_id,batch_code,manufacture_date,expiry_date,available_quantity) VALUES (?,?,?,?,?,?)",
    [uuid(), p.id, `BATCH-${1000 + i}`, daysAgo(Math.floor(Math.random() * 90)), daysFrom(30 + Math.floor(Math.random() * 180)), (Math.random() * 150 + 20).toFixed(2)],
  );
}
console.log("production runs/batches added");

// ---------- purchase orders ----------
const suppliers = ["Malabar Spice Exports", "Deccan Grain Traders", "South Star Feeds"];
const poStatuses = ["received", "received", "partial", "draft", "ordered"];
for (let i = 0; i < 6; i++) {
  const poId = uuid();
  const status = poStatuses[Math.floor(Math.random() * poStatuses.length)];
  const total = (Math.random() * 50000 + 10000).toFixed(2);
  await q(
    "INSERT INTO purchase_orders (id,po_number,supplier_name,supplier_gstin,status,order_date,expected_date,total_amount,notes,received_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,NOW())",
    [poId, `PO-2026-${String(1000 + i).padStart(4, "0")}`, suppliers[Math.floor(Math.random() * suppliers.length)], "29ABCDE1234F1Z5", status, daysAgo(Math.floor(Math.random() * 60)), daysFrom(Math.floor(Math.random() * 14)), total, "Bulk raw material purchase", status === "received" ? daysAgo(Math.floor(Math.random() * 30)) + " 09:00:00" : null],
  );
  // lines
  const numLines = 2 + Math.floor(Math.random() * 2);
  for (let l = 0; l < numLines; l++) {
    const p = raw[Math.floor(Math.random() * raw.length)];
    const qty = (Math.random() * 500 + 100).toFixed(2);
    const unit = (Math.random() * 20 + 15).toFixed(2);
    await q(
      "INSERT INTO purchase_order_lines (id,purchase_order_id,product_id,quantity,unit_price,line_total,quantity_received) VALUES (?,?,?,?,?,?,?)",
      [uuid(), poId, p.id, qty, unit, (qty * unit).toFixed(2), status === "received" ? qty : status === "partial" ? (qty * 0.5).toFixed(2) : "0.00"],
    );
  }
}
console.log("purchase orders added");

// ---------- orders + items + invoices + payments ----------
const orderStatuses = ["pending", "approved", "escalated", "director_approved", "dispatched", "delivered", "delivered", "delivered", "cancelled"];
const deliveryStatuses = { pending: "awaiting_dispatch", approved: "awaiting_dispatch", escalated: "awaiting_dispatch", director_approved: "awaiting_dispatch", dispatched: "in_transit", delivered: "delivered", cancelled: "awaiting_dispatch" };

for (let i = 0; i < 22; i++) {
  const orderId = uuid();
  const dealer = dealers[Math.floor(Math.random() * dealers.length)];
  const status = orderStatuses[Math.floor(Math.random() * orderStatuses.length)];
  const numItems = 1 + Math.floor(Math.random() * 3);
  let total = 0;
  const itemRows = [];
  for (let j = 0; j < numItems; j++) {
    const p = sellable[Math.floor(Math.random() * sellable.length)];
    const qty = (Math.random() * 20 + 5).toFixed(2);
    const unit = (Math.random() * 300 + 900).toFixed(2);
    const lineTotal = (qty * unit).toFixed(2);
    total += parseFloat(lineTotal);
    itemRows.push({ product_id: p.id, quantity: qty, unit_price: unit, line_total: lineTotal });
  }
  const created = daysAgo(Math.floor(Math.random() * 75));
  await q(
    "INSERT INTO orders (id,dealer_id,sales_rep_id,status,total_amount,credit_override,requested_delivery_date,dispatch_date,delivery_status,delivered_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    [
      orderId,
      dealer.id,
      salesRepId,
      status,
      total.toFixed(2),
      Math.random() > 0.85 ? 1 : 0,
      daysFrom(Math.floor(Math.random() * 14)),
      status === "dispatched" || status === "delivered" ? daysAgo(Math.floor(Math.random() * 10)) : null,
      deliveryStatuses[status],
      status === "delivered" ? daysAgo(Math.floor(Math.random() * 5)) + " 12:00:00" : null,
      created + " 09:30:00",
    ],
  );
  for (const it of itemRows) {
    await q(
      "INSERT INTO order_items (id,order_id,product_id,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)",
      [uuid(), orderId, it.product_id, it.quantity, it.unit_price, it.line_total],
    );
  }

  // invoice for delivered/director_approved/dispatched
  if (status === "delivered" || status === "dispatched" || status === "director_approved") {
    const invId = uuid();
    const invNum = `INV-2026-${String(100 + i).padStart(3, "0")}`;
    const taxable = (total * 0.95).toFixed(2);
    const gst = (total - parseFloat(taxable)).toFixed(2);
    await q(
      "INSERT INTO invoices (id,order_id,dealer_id,invoice_number,taxable_amount,gst_amount,total_amount,invoice_date,created_at) VALUES (?,?,?,?,?,?,?, ?,NOW())",
      [invId, orderId, dealer.id, invNum, taxable, gst, total.toFixed(2), created],
    );
    // payment(s)
    if (Math.random() > 0.3) {
      const payAmt = Math.random() > 0.5 ? total.toFixed(2) : (total * 0.5).toFixed(2);
      await q(
        "INSERT INTO payments (id,invoice_id,dealer_id,amount,payment_date,mode,reference) VALUES (?,?,?,?,?,?,?)",
        [uuid(), invId, dealer.id, payAmt, daysAgo(Math.floor(Math.random() * 20)), ["bank_transfer", "cheque", "cash", "upi"][Math.floor(Math.random() * 4)], `TXN-${1000 + i}`],
      );
    }
  }
}
console.log("orders/invoices/payments added");

// ---------- expense heads ----------
const heads = [
  { name: "Raw Materials", description: "Purchase of raw materials", sort_order: 1 },
  { name: "Salaries", description: "Staff salaries", sort_order: 2 },
  { name: "Utilities", description: "Electricity, water, fuel", sort_order: 3 },
  { name: "Logistics", description: "Transport and freight", sort_order: 4 },
  { name: "Maintenance", description: "Plant maintenance", sort_order: 5 },
];
const headIds = [];
for (const h of heads) {
  const id = uuid();
  headIds.push(id);
  try {
    await q("INSERT INTO expense_heads (id,name,description,sort_order,is_active) VALUES (?,?,?,?,1)", [id, h.name, h.description, h.sort_order]);
  } catch (e) {
    // maybe exists; fetch
  }
}
// fetch existing head ids if insert failed
const [existingHeads] = await pool.query("SELECT id FROM expense_heads");
const allHeadIds = existingHeads.map((r) => r.id);

// ---------- expense ledger ----------
const modes = ["cash", "bank_transfer", "cheque", "upi"];
for (let i = 0; i < 25; i++) {
  const hid = allHeadIds[Math.floor(Math.random() * allHeadIds.length)];
  await q(
    "INSERT INTO expense_ledger (id,head_id,expense_date,amount,payment_mode,reference,notes,created_at) VALUES (?,?,?,?,?,?,?,NOW())",
    [uuid(), hid, daysAgo(Math.floor(Math.random() * 90)), (Math.random() * 25000 + 500).toFixed(2), modes[Math.floor(Math.random() * modes.length)], `EXP-${2000 + i}`, "Monthly operating expense"],
  );
}
console.log("expenses added");

// ---------- designations ----------
const desigs = ["Production Manager", "Quality Analyst", "Inventory Manager", "Logistics Coordinator", "Finance Executive", "Sales Executive"];
for (let i = 0; i < desigs.length; i++) {
  await q("INSERT INTO designations (id,name,description,sort_order,is_active) VALUES (?,?,?,?,1)", [uuid(), desigs[i], desigs[i] + " role", i + 1]);
}

// ---------- org positions ----------
const [users] = await pool.query("SELECT id, full_name, role FROM users WHERE is_active=1");
// build a simple tree: admin root, then managers, then reps
const rootId = uuid();
await q("INSERT INTO org_positions (id,title,parent_id,sort_order,user_id) VALUES (?,?,?,?,?)", [rootId, "Managing Director", null, 0, adminId]);
const mgrPos = [];
for (const u of users.filter((u) => u.role.includes("manager") || u.role === "sales_director")) {
  const pid = uuid();
  mgrPos.push(pid);
  await q("INSERT INTO org_positions (id,title,parent_id,sort_order,user_id) VALUES (?,?,?,?,?)", [pid, u.full_name, rootId, mgrPos.length, u.id]);
}
for (const u of users.filter((u) => u.role === "sales_rep" || u.role === "finance")) {
  const pid = uuid();
  const parent = mgrPos.length ? mgrPos[Math.floor(Math.random() * mgrPos.length)] : rootId;
  await q("INSERT INTO org_positions (id,title,parent_id,sort_order,user_id) VALUES (?,?,?,?,?)", [pid, u.full_name, parent, 99, u.id]);
}
console.log("org positions added");

// ---------- finance settings (ensure one row) ----------
try {
  await q("INSERT INTO finance_settings (id,gst_rate,company_state,price_includes_gst,ageing_grace_days,ageing_bucket_1_days,ageing_bucket_2_days,ageing_bucket_3_days,credit_counts_current_invoices) VALUES (1,0.0500,'Maharashtra',0,7,30,60,90,1)");
} catch (e) {
  // ignore
}

await pool.end();
console.log("SEED COMPLETE");
