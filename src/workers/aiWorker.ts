import { Pool } from 'pg';
import axios from 'axios';

const BUBBLE_AI_URL =
  process.env.BUBBLE_AI_URL ||
  'https://smartfilterpro-scaling.bubbleapps.io/version-test/api/1.1/wf/filter_prediction_update';

const DEFAULT_EXPECTED_MULTIPLIER = parseFloat(process.env.FILTER_EXPECTED_MULTIPLIER || '3.0');

export async function aiWorker(pool: Pool) {
  console.log('🧠 Starting AI Worker (rule-based prediction)...');

  const query = `
    WITH latest_reset AS (
      SELECT device_id, MAX(reset_timestamp) AS last_reset
      FROM filter_resets
      GROUP BY device_id
    ),
    device_runtime AS (
      SELECT
        d.device_id,
        d.zip_prefix,
        COALESCE(lr.last_reset, CURRENT_DATE - INTERVAL '30 days') AS last_reset,
        SUM(s.runtime_seconds_total) AS runtime_since_reset
      FROM devices d
      LEFT JOIN latest_reset lr ON d.device_id = lr.device_id
      LEFT JOIN summaries_daily s
        ON s.device_id = d.device_id
       AND s.date >= COALESCE(DATE(lr.last_reset), CURRENT_DATE - INTERVAL '30 days')
      GROUP BY d.device_id, d.zip_prefix, lr.last_reset
    ),
    regional_avg AS (
      SELECT zip_prefix, AVG(avg_runtime_seconds) AS avg_runtime
      FROM region_averages
      WHERE date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY zip_prefix
    )
    SELECT
      dr.device_id,
      dr.zip_prefix,
      dr.last_reset,
      dr.runtime_since_reset,
      ra.avg_runtime
    FROM device_runtime dr
    LEFT JOIN regional_avg ra ON ra.zip_prefix = dr.zip_prefix;
  `;

  const { rows } = await pool.query(query);
  console.log(`🧩 Fetched ${rows.length} device records for prediction`);

  for (const row of rows) {
    const {
      device_id,
      zip_prefix,
      runtime_since_reset,
      avg_runtime,
      last_reset
    } = row;

    if (!runtime_since_reset) continue;

    // baseline life = 3x regional average, fallback if null
    const expected_life =
      avg_runtime && avg_runtime > 0
        ? avg_runtime * DEFAULT_EXPECTED_MULTIPLIER
        : 200000; // fallback (≈55 hours)

    const predicted_health_raw = 1 - runtime_since_reset / expected_life;
    const predicted_health = Math.max(0, Math.min(1, predicted_health_raw));
    const predicted_pct = Math.round(predicted_health * 100);

    // anomaly detection: if runtime 2x region average
    const is_anomalous =
      avg_runtime && runtime_since_reset > avg_runtime * 2 * DEFAULT_EXPECTED_MULTIPLIER;

    try {
      await axios.post(BUBBLE_AI_URL, {
        device_id,
        zip_prefix,
        last_reset,
        runtime_since_reset,
        region_avg_runtime: avg_runtime,
        predicted_filter_health: predicted_pct,
        is_anomalous
      });
      console.log(`📤 AI prediction sent for ${device_id}: ${predicted_pct}%`);
    } catch (err: any) {
      console.error(`❌ Failed posting AI result for ${device_id}:`, err.message);
    }
  }

  console.log('🧠 AI Worker complete.');
}
