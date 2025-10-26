// src/workers/summaryWorker.ts
import { Pool } from 'pg';

export async function runSummaryWorker(pool: Pool, options?: { fullHistory?: boolean; days?: number }) {
const mode = options?.fullHistory ? 'ALL HISTORY' : `LAST ${options?.days || 7} DAYS`;
  console.log(`📊 Starting daily summary worker (${mode})...`);

  // Build date filter based on mode
  const dateFilter = options?.fullHistory
    ? '' // No date filter = process all data
    : `AND rs.started_at >= CURRENT_DATE - INTERVAL '${options?.days || 7} days'`;

  console.log('📊 Starting daily summary worker...');
  const query = `
    WITH daily AS (
      SELECT
        d.device_id,
        DATE(rs.started_at) AS date,
        SUM(COALESCE(rs.runtime_seconds, 0))::INT AS runtime_seconds_total,
 SUM(CASE WHEN rs.mode = 'heat' THEN COALESCE(rs.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_heat,
  SUM(CASE WHEN rs.mode = 'cool' THEN COALESCE(rs.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_cool,
  SUM(CASE WHEN rs.mode = 'fan' THEN COALESCE(rs.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_fan,
  SUM(CASE WHEN rs.mode = 'auxheat' THEN COALESCE(rs.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_auxheat,
  SUM(CASE WHEN rs.mode NOT IN ('heat', 'cool', 'fan', 'auxheat') OR rs.mode IS NULL THEN COALESCE(rs.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_unknown,
  
        COUNT(*) AS runtime_sessions_count,
        AVG(COALESCE(rs.runtime_seconds, 0))::NUMERIC AS avg_runtime,
        AVG(ev.last_temperature)::NUMERIC AS avg_temperature,
        AVG(ev.last_humidity)::NUMERIC AS avg_humidity
      FROM runtime_sessions rs
      JOIN devices d ON d.device_key = rs.device_key
      LEFT JOIN equipment_events ev
        ON rs.device_key = ev.device_key
        AND ev.recorded_at BETWEEN rs.started_at AND COALESCE(rs.ended_at, rs.started_at)
      WHERE rs.started_at IS NOT NULL
        AND d.device_id IS NOT NULL
        ${dateFilter}
        AND rs.started_at IS NOT NULL
        AND d.device_id IS NOT NULL
      GROUP BY d.device_id, DATE(rs.started_at)
    )
    INSERT INTO summaries_daily (
      device_id,
      date,
      runtime_seconds_total,
      runtime_seconds_heat,
      runtime_seconds_cool,
      runtime_seconds_fan,
      runtime_seconds_auxheat,
      runtime_seconds_unknown,
      runtime_sessions_count,
      avg_temperature,
      avg_humidity,
      updated_at
    )
    SELECT
      device_id,
      date,
      runtime_seconds_total,
      runtime_seconds_heat,
      runtime_seconds_cool,
      runtime_seconds_fan,
      runtime_seconds_auxheat,
      runtime_seconds_unknown,
      runtime_sessions_count,
      avg_temperature,
      avg_humidity,
      NOW()
    FROM daily
    ON CONFLICT (device_id, date)
    DO UPDATE SET
      runtime_seconds_total = EXCLUDED.runtime_seconds_total,
      runtime_seconds_heat = EXCLUDED.runtime_seconds_heat,
      runtime_seconds_cool = EXCLUDED.runtime_seconds_cool,
      runtime_seconds_fan = EXCLUDED.runtime_seconds_fan,
      runtime_seconds_auxheat = EXCLUDED.runtime_seconds_auxheat,
      runtime_seconds_unknown = EXCLUDED.runtime_seconds_unknown,
      runtime_sessions_count = EXCLUDED.runtime_sessions_count,
      avg_temperature = EXCLUDED.avg_temperature,
      avg_humidity = EXCLUDED.avg_humidity,
      updated_at = NOW();
  `;
  try {
    const result = await pool.query(query);
    console.log(`✅ Summary worker complete. ${result.rowCount ?? 0} records updated.`);
    return { success: true, records: result.rowCount ?? 0 };
  } catch (err: any) {
    console.error('❌ Summary worker error:', err.message);
    return { success: false, error: err.message };
  }
}

// CLI entry point
if (require.main === module) {
  const { pool } = require('../db/pool');

  // Parse command line arguments
  const args = process.argv.slice(2);
  const fullHistory = args.includes('--all') || args.includes('--full');
  const daysArg = args.find(arg => arg.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1]) : 7;

  runSummaryWorker(pool, { fullHistory, days })
    .then((result) => {
      console.log('✅ Summary worker finished:', result);
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('❌ Fatal error:', err);
      process.exit(1);
    });
}
