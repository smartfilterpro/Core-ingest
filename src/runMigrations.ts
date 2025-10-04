import fs from "fs";
import path from "path";
import { pool } from "./db/pool";

async function runMigrations() {
  console.log("Running migrations...");
  const client = await pool.connect();

  try {
    const dir = path.join(__dirname, "db/migrations");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      console.log(`🟡 Running migration: ${file}`);
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await client.query(sql);
      console.log(`✅ Completed ${file}`);
    }
  } catch (err: any) {
    console.error("❌ Migration error:", err.message);
  } finally {
    client.release();
  }
}

runMigrations()
  .then(() => {
    console.log("✅ All migrations complete");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Migration run failed:", err.message);
    process.exit(1);
  });
