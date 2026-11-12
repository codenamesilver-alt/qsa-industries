import mysql from "mysql2/promise";
const pool = await mysql.createConnection({
  host: process.env.MYSQL_HOST || "localhost",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "qsa_user",
  password: process.env.MYSQL_PASSWORD || "Qsa@Demo2026",
  database: process.env.MYSQL_DATABASE || "qsa_erp",
});
const [tables] = await pool.query("SHOW TABLES");
const empty = [];
for (const t of tables) {
  const name = Object.values(t)[0];
  const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM \`${name}\``);
  if (rows[0].c === 0) empty.push(name);
}
console.log(JSON.stringify(empty, null, 2));
console.log("empty count", empty.length);
await pool.end();