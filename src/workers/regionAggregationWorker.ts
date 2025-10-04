import { Pool } from 'pg';
import axios from 'axios';

const BUBBLE_API_URL = process.env.BUBBLE_REGION_UPDATE_URL;
const REGION_AGG_LOOKBACK_DAYS = parseInt(process.env.REGION_AGG_LOOKBACK_DAYS || '3');

export async function regionAggregationWorker(pool: Pool) {
  console.log('🌎 Aggregating region data...');

  const query = `
    WITH recent AS (
      SELECT
        d.zip_prefix,
        s.date,
        AVG(s.runtime_seconds_total)::NUMERIC AS avg_runtime_seconds,
        AVG(s.avg_temperature)::NUMERIC AS avg_temperature,
        COUNT(DISTINCT s.device_id) AS device_count
      FROM summaries_daily s
      JOIN devices d ON d.device_id = s.device_id
      WHERE s.date >= CURRENT_DATE - INTERVAL '${REGION_AGG_LOOKBACK_DAYS} days'
      GROUP BY d.zip_prefix, s.date
    )
    INSERT INTO region_averages (zip_prefix, date, avg_runtime_seconds, avg_temp, updated_at)
    SELECT r.zip_prefix, r.date, r.avg_runtime_seconds, r.avg_temperature, NOW()
    FROM recent r
    ON CONFLICT (zip_prefix, date)
    DO UPDATE SET
      avg_runtime_seconds = EXCLUDED.avg_runtime_seconds,
      avg_temp = EXCLUDED.avg_temp,
      updated_at = NOW()
    RETURNING *;
  `;

  const { rows } = await pool.query(query);
  console.log(`✅ Aggregated ${rows.length} regional rows`);

  if (BUBBLE_API_URL && rows.length > 0) {
    for (const row of rows) {
      try {
        await axios.post(BUBBLE_API_URL, {
          zip_prefix: row.zip_prefix,
          date: row.date,
          avg_runtime_seconds: row.avg_runtime_seconds,
          avg_temp: row.avg_temp,
          device_count: row.device_count,
        });
        console.log(`📤 Synced region ${row.zip_prefix} for ${row.date}`);
      } catch (err: any) {
        console.error(`❌ Bubble sync failed for ${row.zip_prefix}`, err.message);
      }
    }
  }

  console.log('🌎 Region aggregation worker done.');
}
