import fs from "fs";
import path from "path";
import { pool } from "./db/pool";

async function runMigrations() {
  console.log("[Migrations] Starting database migrations...");
  const client = await pool.connect();

  try {
    // Create migrations tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const dir = path.join(__dirname, "db/migrations");
    
    // Check if migrations directory exists
    if (!fs.existsSync(dir)) {
      console.log("[Migrations] No migrations directory found, skipping...");
      return;
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    if (files.length === 0) {
      console.log("[Migrations] No migration files found");
      return;
    }

    for (const file of files) {
      // Check if migration already applied
      const { rows } = await client.query(
        "SELECT 1 FROM schema_migrations WHERE filename = $1",
        [file]
      );

      if (rows.length > 0) {
        console.log(`[Migrations] ⏭️  Skipping ${file} (already applied)`);
        continue;
      }

      console.log(`[Migrations] 🔄 Running migration: ${file}`);
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [file]
        );
        await client.query("COMMIT");
        console.log(`[Migrations] ✅ Completed ${file}`);
      } catch (err: any) {
        await client.query("ROLLBACK");
        console.error(`[Migrations] ❌ Failed ${file}:`, err.message);
        throw err;
      }
    }

    console.log("[Migrations] ✅ All migrations complete");
  } catch (err: any) {
    console.error("[Migrations] ❌ Migration error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

// Allow running directly or as module
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log("[Migrations] ✅ All migrations complete");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[Migrations] ❌ Migration run failed:", err.message);
      process.exit(1);
    });
}

export { runMigrations };
