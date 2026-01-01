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

const BUBBLE_SUMMARY_SYNC_URL =
  process.env.BUBBLE_SUMMARY_SYNC_URL ||
  'https://smartfilterpro-scaling.bubbleapps.io/version-test/api/1.1/wf/core_ingest_summary';

const BUBBLE_API_KEY = process.env.BUBBLE_API_KEY;

// Simple exponential backoff retry
async function postWithRetry(
  payload: any,
  retries = 3,
  delayMs = 2000
): Promise<AxiosResponse<any>> {
  let attempt = 0;

  if (!BUBBLE_API_KEY) {
    console.warn('[bubbleSummarySync] Warning: BUBBLE_API_KEY is not set');
  }

  while (attempt <= retries) {
    try {
      const res = await axios.post(BUBBLE_SUMMARY_SYNC_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${BUBBLE_API_KEY}`,
        },
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
    // Query device_states for cumulative runtime data, not summaries_daily
    // device_states.hours_used_total = total cumulative runtime (e.g., 174 hours)
    // device_states.filter_hours_used = runtime since last filter reset
    const { rows } = await client.query(`
      SELECT
        d.device_id,
        d.device_name,
        d.filter_usage_percent,
        d.filter_target_hours,
        ds.hours_used_total,
        ds.filter_hours_used,
        ds.last_reset_ts
      FROM devices d
      LEFT JOIN device_states ds ON d.device_key = ds.device_key
      WHERE d.device_id IS NOT NULL
        AND ds.device_key IS NOT NULL
      ORDER BY ds.last_event_ts DESC NULLS LAST
      LIMIT 25
    `);

    for (const row of rows) {
      const filterUsage = parseFloat(row.filter_usage_percent) || 0;
      // Convert hours to seconds for runtime_seconds_total
      const hoursUsedTotal = parseFloat(row.hours_used_total) || 0;
      const filterHoursUsed = parseFloat(row.filter_hours_used) || 0;
      const payload = {
        device_id: row.device_id,
        device_name: row.device_name,
        filter_remaining_percent: Math.round(100 - filterUsage),
        filter_target_hours: parseFloat(row.filter_target_hours) || 100,
        // Send cumulative totals, not daily totals
        runtime_seconds_total: Math.round(hoursUsedTotal * 3600),
        filter_runtime_seconds: Math.round(filterHoursUsed * 3600),
        last_reset_ts: row.last_reset_ts,
      };

      try {
        const res = await postWithRetry(payload, 3, 2000);
        if (res) {
          console.log(
            `[bubbleSummarySync] Synced ${row.device_id} (${hoursUsedTotal.toFixed(1)}h total) → ${res.status}`
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
