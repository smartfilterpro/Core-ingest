import { Pool } from 'pg';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

const BUBBLE_SYNC_URL =
  process.env.BUBBLE_SYNC_URL ||
  'https://smartfilterpro-scaling.bubbleapps.io/version-test/api/1.1/wf/core_ingest_summary';

export async function bubbleSync() {
  console.log('[bubbleSync] Starting Bubble summary sync...');
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT device_id, date, runtime_seconds_total, runtime_sessions_count, avg_temperature
      FROM summaries_daily
      ORDER BY updated_at DESC
      LIMIT 25
    `);

    for (const row of rows) {
      const payload = {
        device_id: row.device_id,
        date: row.date,
        runtime_seconds_total: row.runtime_seconds_total,
        runtime_sessions_count: row.runtime_sessions_count,
        avg_temperature: row.avg_temperature,
      };

      try {
        const res = await axios.post(BUBBLE_SYNC_URL, payload, {
          headers: { 'Content-Type': 'application/json' },
        });
        console.log(`[bubbleSync] Synced ${row.device_id} (${row.date}) → ${res.status}`);
      } catch (err: any) {
        console.error(`[bubbleSync] Failed to sync ${row.device_id}:`, err.message);
      }
    }

    console.log('[bubbleSync] Completed.');
    return { success: true, count: rows.length };
  } finally {
    client.release();
  }
}
