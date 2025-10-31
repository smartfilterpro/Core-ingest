/**
 * One-time script to backfill region_averages for the last N days
 *
 * Usage:
 *   ts-node scripts/backfill-regions.ts [days]
 *
 * Example:
 *   ts-node scripts/backfill-regions.ts 20
 */

import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const LOOKBACK_DAYS = parseInt(process.argv[2] || '20');

async function backfillRegionAverages() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined
  });

  console.log(`🌎 Starting region averages backfill for last ${LOOKBACK_DAYS} days...`);

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
      WHERE s.date >= CURRENT_DATE - INTERVAL '${LOOKBACK_DAYS} days'
        AND d.zip_prefix IS NOT NULL
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
    RETURNING region_prefix, date, sample_size;
  `;

  try {
    const { rows } = await pool.query(query);

    console.log(`✅ Backfill complete: ${rows.length} region/date combinations processed`);

    // Show summary
    const summary = await pool.query(`
      SELECT
        region_prefix,
        COUNT(*) as days_filled,
        MIN(date) as earliest_date,
        MAX(date) as latest_date,
        AVG(sample_size)::INTEGER as avg_devices
      FROM region_averages
      WHERE date >= CURRENT_DATE - INTERVAL '${LOOKBACK_DAYS} days'
      GROUP BY region_prefix
      ORDER BY region_prefix
    `);

    console.log('\n📊 Summary by region:');
    console.table(summary.rows);

  } catch (err: any) {
    console.error('❌ Backfill failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

backfillRegionAverages();
