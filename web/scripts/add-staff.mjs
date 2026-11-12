import mysql from "mysql2/promise";

const pool = await mysql.createConnection({
  host: process.env.MYSQL_HOST || "localhost",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "qsa_user",
  password: process.env.MYSQL_PASSWORD || "Qsa@Demo2026",
  database: process.env.MYSQL_DATABASE || "qsa_erp",
  charset: "utf8mb4",
});

const q = (sql, params = []) => pool.execute(sql, params);
const uuid = () => crypto.randomUUID();
import { randomUUID as cryptoRandomUUID } from "crypto";
const newUuid = () => cryptoRandomUUID();

const HASH = "$2b$10$kPdzg5GR941gOUbtzUL0DugcJvTM1Hifis9Dz07izJldxYBwn5PfK";

// ---------- new designations ----------
const newDesigs = [
  "Production Supervisor",
  "Quality Control Inspector",
  "Warehouse Supervisor",
  "Procurement Officer",
  "Dispatch Coordinator",
  "Accounts Executive",
  "HR Executive",
  "Logistics Executive",
  "Inventory Clerk",
];
const desigIds = {};
for (const name of newDesigs) {
  const [rows] = await pool.query("SELECT id FROM designations WHERE name=?", [name]);
  if (rows.length) {
    desigIds[name] = rows[0].id;
  } else {
    const id = newUuid();
    await q("INSERT INTO designations (id,name,description,sort_order,is_active) VALUES (?,?,?,?,1)", [id, name, name + " role", 99]);
    desigIds[name] = id;
  }
}
// fetch all designations
const [allDesigs] = await pool.query("SELECT id,name FROM designations");
for (const d of allDesigs) desigIds[d.name] = d.id;

// helper to get user id by email
async function userIdByEmail(email) {
  const [rows] = await pool.query("SELECT id FROM users WHERE email=?", [email]);
  return rows.length ? rows[0].id : null;
}

// ---------- staff to add ----------
const staff = [
  // Production
  { name: "Vikram Rao", email: "vikram.rao@qsa-demo.in", role: "production_manager", desig: "Production Supervisor", reportsTo: "operations.production@qsa-demo.in", sort: 8 },
  { name: "Suresh Kumar", email: "suresh.kumar@qsa-demo.in", role: "qc_staff", desig: "Quality Control Inspector", reportsTo: "operations.production@qsa-demo.in", sort: 9 },
  { name: "Ananya Das", email: "ananya.das@qsa-demo.in", role: "qc_staff", desig: "Quality Analyst", reportsTo: "operations.production@qsa-demo.in", sort: 10 },
  { name: "Ramesh Yadav", email: "ramesh.yadav@qsa-demo.in", role: "production_manager", desig: "Production Supervisor", reportsTo: "operations.production@qsa-demo.in", sort: 11 },
  // Inventory
  { name: "Deepak Verma", email: "deepak.verma@qsa-demo.in", role: "inventory_manager", desig: "Warehouse Supervisor", reportsTo: "operations.inventory@qsa-demo.in", sort: 12 },
  { name: "Pooja Sharma", email: "pooja.sharma@qsa-demo.in", role: "inventory_manager", desig: "Inventory Clerk", reportsTo: "operations.inventory@qsa-demo.in", sort: 13 },
  { name: "Manish Gupta", email: "manish.gupta@qsa-demo.in", role: "inventory_manager", desig: "Procurement Officer", reportsTo: "operations.inventory@qsa-demo.in", sort: 14 },
  // Logistics
  { name: "Rohit Singh", email: "rohit.singh@qsa-demo.in", role: "logistics", desig: "Dispatch Coordinator", reportsTo: "logistics@qsa-demo.in", sort: 15 },
  { name: "Amit Patel", email: "amit.patel@qsa-demo.in", role: "logistics", desig: "Logistics Executive", reportsTo: "logistics@qsa-demo.in", sort: 16 },
  { name: "Sanjay Kumar", email: "sanjay.kumar@qsa-demo.in", role: "logistics", desig: "Dispatch Coordinator", reportsTo: "logistics@qsa-demo.in", sort: 17 },
  // Finance
  { name: "Kavita Menon", email: "kavita.menon@qsa-demo.in", role: "finance", desig: "Accounts Executive", reportsTo: "finance@qsa-demo.in", sort: 18 },
  { name: "Rahul Joshi", email: "rahul.joshi@qsa-demo.in", role: "finance", desig: "Finance Executive", reportsTo: "finance@qsa-demo.in", sort: 19 },
  // Sales
  { name: "Arjun Sharma", email: "arjun.sharma@qsa-demo.in", role: "sales_rep", desig: "Sales Executive", reportsTo: "imran.sheikh@qsa-demo.in", sort: 20 },
  { name: "Neha Gupta", email: "neha.gupta@qsa-demo.in", role: "sales_rep", desig: "Sales Executive", reportsTo: "meera.nair@qsa-demo.in", sort: 21 },
  { name: "Karthik Iyer", email: "karthik.iyer@qsa-demo.in", role: "sales_rep", desig: "Sales Executive", reportsTo: "imran.sheikh@qsa-demo.in", sort: 22 },
  { name: "Divya Nair", email: "divya.nair@qsa-demo.in", role: "sales_rep", desig: "Sales Executive", reportsTo: "meera.nair@qsa-demo.in", sort: 23 },
  { name: "Siddharth Rao", email: "siddharth.rao@qsa-demo.in", role: "sales_rep", desig: "Sales Executive", reportsTo: "imran.sheikh@qsa-demo.in", sort: 24 },
  // Admin/HR
  { name: "Sneha Reddy", email: "sneha.reddy@qsa-demo.in", role: "admin", desig: "HR Executive", reportsTo: "admin@qsa-demo.in", sort: 25 },
  { name: "Vivek Tiwari", email: "vivek.tiwari@qsa-demo.in", role: "admin", desig: "HR Executive", reportsTo: "admin@qsa-demo.in", sort: 26 },
];

for (const s of staff) {
  // skip if already exists
  const [existing] = await pool.query("SELECT id FROM users WHERE email=?", [s.email]);
  let userId;
  if (existing.length) {
    userId = existing[0].id;
  } else {
    userId = newUuid();
    await q(
      "INSERT INTO users (id,full_name,email,role,is_active,phone,password_hash,reports_to_id,designation_id,sort_order,created_at) VALUES (?,?,?,?,1,NULL,?,?,?,?,NOW())",
      [userId, s.name, s.email, s.role, HASH, null, desigIds[s.desig], s.sort],
    );
  }
  const reportsToId = await userIdByEmail(s.reportsTo);
  await q("UPDATE users SET reports_to_id=?, designation_id=?, sort_order=? WHERE id=?", [reportsToId, desigIds[s.desig], s.sort, userId]);
}

// update sort_order for existing staff too (ensure ordering)
await q("UPDATE users SET sort_order=0 WHERE email='admin@qsa-demo.in'");
await q("UPDATE users SET sort_order=1 WHERE email='nadia.kapoor@qsa-demo.in'");

await pool.end();
console.log("STAFF ADDED. Total new:", staff.length);
