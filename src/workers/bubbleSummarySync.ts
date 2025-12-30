import { Pool } from 'pg';
import axios, { AxiosResponse } from 'axios';
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

// Simple exponential backoff retry
async function postWithRetry(
  payload: any,
  retries = 3,
  delayMs = 2000
): Promise<AxiosResponse<any>> {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const res = await axios.post(BUBBLE_SYNC_URL, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      return res;
    } catch (err: any) {
      attempt++;
      const status = err.response?.status;
      const isRetryable = !status || status >= 500 || status === 429;
      if (!isRetryable || attempt > retries) {
        console.error(`[bubbleSummarySync] Permanent failure: ${err.message}`);
        throw err;
      }
      const wait = delayMs * attempt;
      console.warn(`[bubbleSummarySync] Retry ${attempt}/${retries} after ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error('postWithRetry exited without returning'); // satisfies TS
}

export async function bubbleSummarySync() {
  console.log('[bubbleSummarySync] Starting Bubble summary push with retry...');
  const client = await pool.connect();
  let successCount = 0;
  try {
    const { rows } = await client.query(`
      SELECT
        s.device_id,
        d.device_name,
        s.date,
        s.runtime_seconds_total,
        s.runtime_sessions_count,
        s.avg_temperature
      FROM summaries_daily s
      LEFT JOIN devices d ON s.device_id = d.device_id
      ORDER BY s.updated_at DESC
      LIMIT 25
    `);

    for (const row of rows) {
      const payload = {
        device_id: row.device_id,
        device_name: row.device_name,
        date: row.date,
        runtime_seconds_total: row.runtime_seconds_total,
        runtime_sessions_count: row.runtime_sessions_count,
        avg_temperature: row.avg_temperature,
      };

      try {
        const res = await postWithRetry(payload, 3, 2000);
        if (res) {
          console.log(
            `[bubbleSummarySync] Synced ${row.device_id} (${row.date}) → ${res.status}`
          );
        }
        successCount++;
      } catch (err: any) {
        console.error(`[bubbleSummarySync] Failed ${row.device_id}:`, err.message);
      }
    }

    console.log(`[bubbleSummarySync] Completed (${successCount}/${rows.length} successful).`);
    return { success: true, count: successCount };
  } finally {
    client.release();
  }
}
