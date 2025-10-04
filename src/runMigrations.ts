import fs from "fs";
import path from "path";
import { pool } from "../db.js";
import { logger } from "../logger.js";

async function runMigrations() {
  try {
    const migrationDir = path.join(process.cwd(), "migrations");
    const files = fs
      .readdirSync(migrationDir)
      .filter(f => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const filePath = path.join(migrationDir, file);
      const sql = fs.readFileSync(filePath, "utf8");

      logger.info(`🟢 Running migration: ${file}`);
      await pool.query(sql);
      logger.info(`✅ Migration ${file} applied successfully.`);
    }

    process.exit(0);
  } catch (err: any) {
    logger.error({ err }, "Migration failed");
    process.exit(1);
  }
}

runMigrations();
