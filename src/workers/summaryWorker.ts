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
        rs.ended_at,
        rs.runtime_seconds,
        rs.mode as equipment_mode,
        ee.thermostat_mode,
        ee.last_temperature,
        ee.last_humidity
      FROM runtime_sessions rs
      LEFT JOIN equipment_events ee
        ON rs.device_key = ee.device_key
        AND ee.recorded_at <= COALESCE(rs.ended_at, rs.started_at)
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
        -- Operating Mode Distribution (what users SET thermostat to) - USING thermostat_mode!
        SUM(CASE WHEN stm.thermostat_mode = 'heat' THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_mode_heat,
        SUM(CASE WHEN stm.thermostat_mode = 'cool' THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_mode_cool,
        SUM(CASE WHEN stm.thermostat_mode IN ('auto', 'heat-cool') THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_mode_auto,
        SUM(CASE WHEN stm.thermostat_mode = 'off' THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_mode_off,
        SUM(CASE WHEN stm.thermostat_mode IN ('away', 'vacation') THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_mode_away,
        SUM(CASE WHEN stm.thermostat_mode IN ('eco', 'energy_saver') THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_mode_eco,
        SUM(CASE WHEN stm.thermostat_mode NOT IN ('heat', 'cool', 'auto', 'heat-cool', 'off', 'away', 'vacation', 'eco', 'energy_saver') AND stm.thermostat_mode IS NOT NULL THEN COALESCE(stm.runtime_seconds, 0) ELSE 0 END)::INT AS runtime_seconds_mode_other,
        COUNT(*) AS runtime_sessions_count,
        AVG(stm.last_temperature)::NUMERIC AS avg_temperature,
        AVG(stm.last_humidity)::NUMERIC AS avg_humidity
      FROM session_thermostat_modes stm
      JOIN devices d ON d.device_key = stm.device_key
      WHERE d.device_id IS NOT NULL
      GROUP BY d.device_id, DATE(stm.started_at)
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
      runtime_seconds_mode_heat,
      runtime_seconds_mode_cool,
      runtime_seconds_mode_auto,
      runtime_seconds_mode_off,
      runtime_seconds_mode_away,
      runtime_seconds_mode_eco,
      runtime_seconds_mode_other,
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
      runtime_seconds_mode_heat,
      runtime_seconds_mode_cool,
      runtime_seconds_mode_auto,
      runtime_seconds_mode_off,
      runtime_seconds_mode_away,
      runtime_seconds_mode_eco,
      runtime_seconds_mode_other,
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
      runtime_seconds_mode_heat = EXCLUDED.runtime_seconds_mode_heat,
      runtime_seconds_mode_cool = EXCLUDED.runtime_seconds_mode_cool,
      runtime_seconds_mode_auto = EXCLUDED.runtime_seconds_mode_auto,
      runtime_seconds_mode_off = EXCLUDED.runtime_seconds_mode_off,
      runtime_seconds_mode_away = EXCLUDED.runtime_seconds_mode_away,
      runtime_seconds_mode_eco = EXCLUDED.runtime_seconds_mode_eco,
      runtime_seconds_mode_other = EXCLUDED.runtime_seconds_mode_other,
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
