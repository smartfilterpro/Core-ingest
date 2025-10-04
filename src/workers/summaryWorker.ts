import { pool } from "../db/pool";
import { postToBubble } from "../utils/bubbleSync";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import dotenv from "dotenv";

dotenv.config();
dayjs.extend(utc);
dayjs.extend(timezone);

const BUBBLE_URL = process.env.BUBBLE_SUMMARY_SYNC_URL!;
const TZ = process.env.DEFAULT_TIMEZONE || "America/New_York";

/**
 * Run daily summary aggregation from runtime_sessions → summaries_daily → region_averages
 */
export async function runDailySummaryAggregation() {
  console.log("⏱️ Running summary aggregation...");

  const client = await pool.connect();
  try {
    // 1️⃣ Aggregate runtime_sessions into summaries_daily
    const summaryQuery = `
      WITH daily AS (
        SELECT
          device_id,
          DATE(session_start AT TIME ZONE 'UTC' AT TIME ZONE $1) AS summary_date,
          COUNT(*) AS session_count,
          SUM(EXTRACT(EPOCH FROM (session_end - session_start))) AS total_runtime_seconds,
          AVG(EXTRACT(EPOCH FROM (session_end - session_start))) AS avg_session_length_seconds,
          AVG(avg_temp) AS avg_temp,
          MAX(max_temp) AS max_temp,
          MIN(min_temp) AS min_temp
        FROM runtime_sessions
        WHERE session_end IS NOT NULL
        GROUP BY device_id, summary_date
      )
      INSERT INTO summaries_daily (
        device_id,
        summary_date,
        total_runtime_seconds,
        avg_session_length_seconds,
        avg_temp,
        max_temp,
        min_temp,
        session_count,
        runtime_hours,
        updated_at
      )
      SELECT
        device_id,
        summary_date,
        total_runtime_seconds,
        avg_session_length_seconds,
        avg_temp,
        max_temp,
        min_temp,
        session_count,
        ROUND(total_runtime_seconds / 3600.0, 2) AS runtime_hours,
        NOW()
      FROM daily
      ON CONFLICT (device_id, summary_date)
      DO UPDATE SET
        total_runtime_seconds = EXCLUDED.total_runtime_seconds,
        avg_session_length_seconds = EXCLUDED.avg_session_length_seconds,
        avg_temp = EXCLUDED.avg_temp,
        max_temp = EXCLUDED.max_temp,
        min_temp = EXCLUDED.min_temp,
        session_count = EXCLUDED.session_count,
        runtime_hours = EXCLUDED.runtime_hours,
        updated_at = NOW();
    `;
    await client.query(summaryQuery, [TZ]);
    console.log("✅ summaries_daily updated");

    // 2️⃣ Compute regional averages
    const regionQuery = `
      INSERT INTO region_averages (zip_prefix, summary_date, avg_runtime_seconds, updated_at)
      SELECT
        LEFT(d.zip_code, 3) AS zip_prefix,
        s.summary_date,
        AVG(s.total_runtime_seconds) AS avg_runtime_seconds,
        NOW()
      FROM summaries_daily s
      JOIN devices d ON s.device_id = d.device_id
      GROUP BY zip_prefix, s.summary_date
      ON CONFLICT (zip_prefix, summary_date)
      DO UPDATE SET
        avg_runtime_seconds = EXCLUDED.avg_runtime_seconds,
        updated_at = NOW();
    `;
    await client.query(regionQuery);
    console.log("✅ region_averages updated");

    // 3️⃣ Sync yesterday’s summaries to Bubble
    const yesterday = dayjs().tz(TZ).subtract(1, "day").format("YYYY-MM-DD");
    const res = await client.query(
      `SELECT s.*, r.avg_runtime_seconds AS region_avg_runtime
       FROM summaries_daily s
       LEFT JOIN region_averages r
         ON LEFT((SELECT zip_code FROM devices d WHERE d.device_id = s.device_id LIMIT 1), 3) = r.zip_prefix
        AND s.summary_date = r.summary_date
       WHERE s.summary_date = $1`,
      [yesterday]
    );

    console.log(`📊 Found ${res.rows.length} summaries to sync`);

    for (const row of res.rows) {
      const payload = {
        device_id: row.device_id,
        summary_date: row.summary_date,
        total_runtime_seconds: row.total_runtime_seconds,
        avg_temp: row.avg_temp,
        session_count: row.session_count,
        region_avg_runtime: row.region_avg_runtime ?? null,
      };
      await postToBubble(BUBBLE_URL, payload);
    }

    console.log(`📤 Synced ${res.rows.length} summaries to Bubble`);
  } catch (err: any) {
    console.error("❌ Summary aggregation error:", err.message);
  } finally {
    client.release();
  }
}

/**
 * Optional CLI entrypoint
 * Example: `node dist/workers/summaryWorker.js --run`
 */
if (process.argv.includes("--run")) {
  runDailySummaryAggregation().then(() => process.exit(0));
}
