import mysql from "mysql2/promise";
import { randomUUID } from "crypto";

const pool = await mysql.createConnection({
  host: process.env.MYSQL_HOST || "localhost",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "qsa_user",
  password: process.env.MYSQL_PASSWORD || "Qsa@Demo2026",
  database: process.env.MYSQL_DATABASE || "qsa_erp",
  charset: "utf8mb4",
  multipleStatements: false,
});

const q = async (sql, params = []) => pool.execute(sql, params);

const DB = "qsa_erp";
const ROWS_PER_TABLE = 3;

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rndInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function isoDate(d = new Date()) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); }
function daysFrom(n) { const d = new Date(); d.setDate(d.getDate() + n); return isoDate(d); }
function rndDateTime() { return daysAgo(rndInt(0, 60)) + " " + String(rndInt(8, 17)).padStart(2, "0") + ":" + String(rndInt(0, 59)).padStart(2, "0") + ":00"; }

const NAMES = ["Ravi Menon", "Nadia Kapoor", "Meera Nair", "Arjun Rao", "Priya Sharma", "Karan Patel", "Anita Desai", "Vikram Singh"];
const SUPPLIERS = ["Malabar Spice Exports", "Deccan Grain Traders", "South Star Feeds", "Agro Supply Co"];
const CITIES = ["Pune", "Mumbai", "Nashik", "Nagpur", "Aurangabad"];

// Load tables
const [tableRows] = await pool.query(
  "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME",
  [DB]
);
const allTables = tableRows.map((r) => r.TABLE_NAME);

// Identify empty tables
const emptyTables = [];
for (const t of allTables) {
  const [r] = await pool.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
  if (r[0].c === 0) emptyTables.push(t);
}

// FK map: table -> [{column, refTable, refColumn}]
const fkMap = {};
for (const t of allTables) {
  const [rows] = await pool.query(
    `SELECT kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE kcu
     WHERE kcu.TABLE_SCHEMA=? AND kcu.TABLE_NAME=? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
    [DB, t]
  );
  fkMap[t] = rows;
}

// PK columns per table
const pkMap = {};
for (const t of allTables) {
  const [rows] = await pool.query(
    `SELECT kcu.COLUMN_NAME
     FROM information_schema.KEY_COLUMN_USAGE kcu
     WHERE kcu.TABLE_SCHEMA=? AND kcu.TABLE_NAME=? AND kcu.CONSTRAINT_NAME='PRIMARY'`,
    [DB, t]
  );
  pkMap[t] = rows.map((r) => r.COLUMN_NAME);
}

// Column metadata
const colMeta = {};
for (const t of allTables) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, CHARACTER_MAXIMUM_LENGTH, COLUMN_TYPE, COLUMN_KEY
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`,
    [DB, t]
  );
  colMeta[t] = rows;
}

// Topological sort among empty tables based on FKs to empty tables
const emptySet = new Set(emptyTables);
const deps = {};
for (const t of emptyTables) {
  deps[t] = new Set();
  for (const fk of fkMap[t]) {
    if (emptySet.has(fk.REFERENCED_TABLE_NAME)) deps[t].add(fk.REFERENCED_TABLE_NAME);
  }
}
const sorted = [];
const visited = new Set();
const visiting = new Set();
function visit(t) {
  if (visited.has(t)) return;
  if (visiting.has(t)) return; // cycle, skip
  visiting.add(t);
  for (const d of deps[t]) visit(d);
  visiting.delete(t);
  visited.add(t);
  sorted.push(t);
}
for (const t of emptyTables) visit(t);

// Cache of inserted PK values per table
const idCache = {};
async function refreshIdCache(t) {
  const pks = pkMap[t];
  if (!pks || pks.length === 0) { idCache[t] = []; return; }
  try {
    const [rows] = await pool.query(`SELECT ${pks.map((c) => `\`${c}\``).join(",")} FROM \`${t}\``);
    idCache[t] = rows;
  } catch (e) {
    idCache[t] = [];
  }
}
// Pre-cache non-empty tables
for (const t of allTables) {
  if (!emptySet.has(t)) await refreshIdCache(t);
}

function parseEnum(ct) {
  const m = ct.match(/^enum\((.*)\)$/);
  if (!m) return null;
  return m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
}

function genValue(t, col, rowIndex) {
  const name = col.COLUMN_NAME.toLowerCase();
  const type = col.DATA_TYPE.toLowerCase();
  const nullable = col.IS_NULLABLE === "YES";
  const extra = (col.EXTRA || "").toLowerCase();
  const ct = col.COLUMN_TYPE || "";

  // dealer_onboardings must use a dealer not already onboarded
  if (t === "dealer_onboardings" && name === "dealer_id" && dealerOnboardingCandidates && dealerOnboardingCandidates.length) {
    return rnd(dealerOnboardingCandidates);
  }

  // FK?
  const fk = fkMap[t].find((f) => f.COLUMN_NAME === col.COLUMN_NAME);
  if (fk) {
    const cached = idCache[fk.REFERENCED_TABLE_NAME] || [];
    if (cached.length) {
      const pick = cached[Math.floor(Math.random() * cached.length)];
      const val = pick[fk.REFERENCED_COLUMN_NAME];
      if (val !== undefined && val !== null) return val;
    }
    if (nullable) return null;
  }

  // auto increment skip handled by caller (not included)
  if (extra.includes("auto_increment")) return null;

  // PK non-auto
  const isPk = pkMap[t].includes(col.COLUMN_NAME);
  if (isPk) {
    if (type === "char" && col.CHARACTER_MAXIMUM_LENGTH === 36) return randomUUID();
    if (type === "varchar" && (name.includes("id") || name.includes("uuid"))) return randomUUID();
    if (type.includes("int")) return 100000 + rowIndex + Math.floor(Math.random() * 1000);
    if (type === "char" || type === "varchar") return randomUUID();
  }

  // enum
  const enums = parseEnum(ct);
  if (enums) return rnd(enums);

  // booleans / flags
  if (name.startsWith("is_") || name.startsWith("has_") || name.includes("active") || name.includes("enabled")) {
    return Math.random() > 0.3 ? 1 : 0;
  }

  // dates/times
  if (type === "date") return rnd([daysAgo(rndInt(0, 90)), daysFrom(rndInt(0, 30))]);
  if (type === "datetime" || type === "timestamp") return rndDateTime();
  if (type === "time") return "09:00:00";
  if (type === "year") return 2026;

  // numeric
  if (type.includes("int") || type === "bigint" || type === "tinyint" || type === "smallint" || type === "mediumint") {
    if (name.includes("quantity") || name.includes("qty")) return rndInt(1, 100);
    if (name.includes("amount") || name.includes("price") || name.includes("cost") || name.includes("value")) return rndInt(100, 5000);
    if (name.includes("sort") || name.includes("order")) return rowIndex;
    return rndInt(1, 50);
  }
  if (type === "decimal" || type === "float" || type === "double") {
    return (Math.random() * 1000 + 1).toFixed(2);
  }

  // JSON-like columns stored as text with a json_valid check
  if (name.includes("attributes") || name.includes("mapping") || name.includes("definition") || name.includes("config") || name.includes("payload") || name.includes("data")) {
    return "{}";
  }
  // unique serial numbers
  if (name.includes("serial") && !name.includes("serial_number_id")) {
    return `SN-${randomUUID()}`;
  }
  // unique uom pairs
  if (name === "from_uom") return `UOM${rowIndex + 1}`;
  if (name === "to_uom") return `UOM${rowIndex + 2}`;
  // strings
  if (type === "char" || type === "varchar") {
    const len = col.CHARACTER_MAXIMUM_LENGTH || 50;
    if (len === 36) return randomUUID();
    if (name.includes("email")) return `user${rowIndex}@example.com`;
    if (name.includes("phone") || name.includes("mobile") || name.includes("tel")) return "9" + String(rndInt(100000000, 999999999));
    if (name.includes("name") && name.includes("supplier")) return rnd(SUPPLIERS);
    if (name.includes("name") && name.includes("city")) return rnd(CITIES);
    if (name.includes("name")) return rnd(NAMES);
    if (name.includes("code") || name.includes("number") || name.includes("no")) return `${name.toUpperCase().slice(0, 4)}-${rowIndex}-${rndInt(100, 999)}`;
    if (name.includes("city")) return rnd(CITIES);
    if (name.includes("status")) return "active";
    if (name.includes("type") || name.includes("mode")) return "default";
    if (name.includes("url") || name.includes("path")) return "/tmp/file";
    if (name.includes("title")) return "Sample " + name;
    if (len <= 5) return "ABC";
    return "Sample " + name.slice(0, 20);
  }
  if (type === "text" || type === "longtext" || type === "mediumtext" || type === "tinytext") {
    if (name.includes("notes") || name.includes("description") || name.includes("remarks")) return "Auto-generated sample text for testing.";
    return "Sample text";
  }
  if (type === "json") return "{}";
  if (type === "blob" || type === "longblob" || type === "mediumblob" || type === "tinyblob") return null;
  if (type === "binary" || type === "varbinary") return null;

  // default
  if (nullable) return null;
  if (type.includes("int")) return 0;
  return "";
}

const errors = [];
let successCount = 0;
let dealerOnboardingCandidates = null;

for (const t of sorted) {
  if (t === "dealer_onboardings") {
    const [usedRows] = await pool.query("SELECT dealer_id FROM dealer_onboardings");
    const used = new Set(usedRows.map((r) => r.dealer_id));
    const allDealers = (idCache.dealers || []).map((r) => r.id);
    dealerOnboardingCandidates = allDealers.filter((id) => !used.has(id));
  }
  const cols = colMeta[t];
  // columns to insert (skip auto_increment)
  const insertCols = cols.filter((c) => !(c.EXTRA || "").toLowerCase().includes("auto_increment"));
  // If table has no insert cols, skip
  if (insertCols.length === 0) continue;

  // Check if still empty (may have been seeded as dependency)
  const [cnt] = await pool.query(`SELECT COUNT(*) AS c FROM \`${t}\``);
  if (cnt[0].c > 0 && emptySet.has(t)) {
    // already has rows (maybe from earlier), skip
    await refreshIdCache(t);
    continue;
  }

  for (let i = 0; i < ROWS_PER_TABLE; i++) {
    const colNames = insertCols.map((c) => c.COLUMN_NAME);
    const values = insertCols.map((c) => genValue(t, c, i));
    const placeholders = colNames.map(() => "?").join(",");
    const sql = `INSERT INTO \`${t}\` (${colNames.map((c) => `\`${c}\``).join(",")}) VALUES (${placeholders})`;
    try {
      await pool.execute(sql, values);
      successCount++;
    } catch (e) {
      errors.push({ table: t, error: e.message, sql });
      // stop inserting more rows for this table after first failure? continue trying
      break;
    }
  }
  await refreshIdCache(t);
}

// Write errors
import { writeFileSync } from "fs";
writeFileSync("C:/Users/syedm/AppData/Local/Temp/opencode/seed-errors.json", JSON.stringify(errors, null, 2));
console.log("Inserted rows (approx):", successCount);
console.log("Errors:", errors.length);
if (errors.length) console.log("First few errors:", errors.slice(0, 10));
await pool.end();