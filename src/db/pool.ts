import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
  max: parseInt(process.env.DB_MAX_CONNECTIONS || "10"),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
