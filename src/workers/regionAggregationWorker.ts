import { Pool } from 'pg';
import axios from 'axios';

const BUBBLE_API_URL = process.env.BUBBLE_REGION_UPDATE_URL;
const REGION_AGG_LOOKBACK_DAYS = parseInt(process.env.REGION_AGG_LOOKBACK_DAYS || '3');

/**
 * Aggregates recent summaries by ZIP prefix into region_averages,
 * and syncs results to Bubble (if configured).
 * Uses device timezone for proper date filtering (dates in summaries_daily are in device local time)
 */
export async function runRegionAggregationWorker(pool: Pool) {
  console.log('🌎 Starting Region Aggregation Worker...');

  // Use device timezone for date filtering since summaries_daily.date is stored in device local time
  const query = `
    WITH recent AS (
      SELECT
        d.zip_prefix,
        s.date,
        AVG(s.runtime_seconds_total)::NUMERIC AS avg_runtime_seconds,
        AVG(s.avg_temperature)::NUMERIC AS avg_temperature,
        AVG(s.avg_humidity)::NUMERIC AS avg_humidity,
        COUNT(DISTINCT s.device_id) AS device_count
      FROM summaries_daily s
      JOIN devices d ON d.device_id = s.device_id
      WHERE s.date >= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(d.timezone, 'UTC'))::DATE - INTERVAL '${REGION_AGG_LOOKBACK_DAYS} days'
        AND d.zip_prefix IS NOT NULL   -- ✅ Skip devices with no ZIP prefix
      GROUP BY d.zip_prefix, s.date
    )
    INSERT INTO region_averages (
      region_prefix,
      date,
      avg_runtime_seconds,
      avg_temp,
      avg_humidity,
      sample_size,
      updated_at
    )
    SELECT
      r.zip_prefix,
      r.date,
      r.avg_runtime_seconds,
      r.avg_temperature,
      r.avg_humidity,
      r.device_count,
      NOW()
    FROM recent r
    ON CONFLICT (region_prefix, date)
    DO UPDATE SET
      avg_runtime_seconds = EXCLUDED.avg_runtime_seconds,
      avg_temp = EXCLUDED.avg_temp,
      avg_humidity = EXCLUDED.avg_humidity,
      sample_size = EXCLUDED.sample_size,
      updated_at = NOW()
    RETURNING *;
  `;

  try {
    const { rows } = await pool.query(query);
    console.log(`✅ Region Aggregation Worker: ${rows.length} regional averages created/updated.`);

    let syncedCount = 0;
    if (BUBBLE_API_URL && rows.length > 0) {
      console.log(`🌐 Syncing ${rows.length} region averages to Bubble...`);
      for (const row of rows) {
        try {
          await axios.post(BUBBLE_API_URL, {
            region_prefix: row.region_prefix,
            date: row.date,
            avg_runtime_seconds: row.avg_runtime_seconds,
            avg_temp: row.avg_temp,
            avg_humidity: row.avg_humidity,
            sample_size: row.sample_size,
          });
          console.log(`📤 Synced region ${row.region_prefix} for ${row.date}`);
          syncedCount++;
        } catch (err: any) {
          console.error(`❌ Bubble sync failed for ${row.region_prefix}: ${err.message}`);
        }
      }
    } else if (!BUBBLE_API_URL) {
      console.warn('⚠️ BUBBLE_REGION_UPDATE_URL not set; skipping region sync.');
    }

    console.log('🌎 Region Aggregation Worker done.');

    return {
      ok: true,
      success: true,
      regions_updated: rows.length,
      synced_to_bubble: syncedCount,
      lookback_days: REGION_AGG_LOOKBACK_DAYS
    };
  } catch (err: any) {
    console.error('[RegionAggregationWorker] Error:', err.message);
    return {
      ok: false,
      success: false,
      error: err.message
    };
  }
}
