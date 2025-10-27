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
    WITH session_thermostat_modes AS (
      -- Get the most recent thermostat_mode for each runtime session
      SELECT DISTINCT ON (rs.session_id)
        rs.session_id,
        rs.device_key,
        rs.started_at,
        rs.runtime_seconds,
        rs.mode as equipment_mode,
        ee.thermostat_mode
      FROM runtime_sessions rs
      LEFT JOIN equipment_events ee
        ON rs.device_key = ee.device_key
        AND ee.thermostat_mode IS NOT NULL
        AND ee.recorded_at <= rs.started_at
      WHERE rs.started_at IS NOT NULL
        ${dateFilter}
      ORDER BY rs.session_id, ee.recorded_at DESC
    ),
    daily AS (
      SELECT
        d.device_id,
        DATE(stm.started_at) AS date,
        SUM(COALESCE(stm.runtime_seconds, 0))::INT AS runtime_seconds_total,
        -- HVAC Mode Breakdown (what equipment is DOING)
        SUM(CASE WHEN stm.equipment_mode = 'heat' THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_heat,
        SUM(CASE WHEN stm.equipment_mode = 'cool' THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_cool,
        SUM(CASE WHEN stm.equipment_mode = 'fan' THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_fan,
        SUM(CASE WHEN stm.equipment_mode = 'auxheat' THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_auxheat,
        SUM(CASE WHEN stm.equipment_mode NOT IN ('heat', 'cool', 'fan', 'auxheat') OR stm.equipment_mode IS NULL THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_unknown,
        -- Operating Mode Distribution (what users SET thermostat to) - NOW USING thermostat_mode!
        SUM(CASE WHEN stm.thermostat_mode IN ('heat') THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_mode_heat,
        SUM(CASE WHEN stm.thermostat_mode IN ('cool') THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_mode_cool,
        SUM(CASE WHEN stm.thermostat_mode IN ('auto', 'heat-cool') THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_mode_auto,
        SUM(CASE WHEN stm.thermostat_mode IN ('off') THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_mode_off,
        SUM(CASE WHEN stm.thermostat_mode IN ('away', 'vacation') THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_mode_away,
        SUM(CASE WHEN stm.thermostat_mode IN ('eco', 'energy_saver') THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_mode_eco,
        SUM(CASE WHEN stm.thermostat_mode NOT IN ('heat', 'cool', 'auto', 'heat-cool', 'off', 'away', 'vacation', 'eco', 'energy_saver') OR stm.thermostat_mode IS NULL THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_mode_other,
        COUNT(*) AS runtime_sessions_count,
        AVG(COALESCE(stm.runtime_seconds, 0))::NUMERIC AS avg_runtime
      FROM session_thermostat_modes stm
      JOIN devices d ON d.device_key = stm.device_key
      WHERE d.device_id IS NOT NULL
      GROUP BY d.device_id, DATE(stm.started_at)
    )
      avg_humidity,
      NOW()
    FROM daily
    ON CONFLICT (device_id, date)
    DO UPDATE SET
      runtime_seconds_total = EXCLUDED.runtime_seconds_total,
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
