import mysql from "mysql2/promise";

export const pool = mysql.createPool({
  host: process.env.DB_HOST || process.env.MYSQL_HOST || "localhost",
  port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
  user: process.env.DB_USER || process.env.MYSQL_USER || "qsa_user",
  password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || "Qsa@Demo2026",
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE || "qsa_erp",
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  charset: "utf8mb4",
  dateStrings: true,
});

export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

export async function queryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}