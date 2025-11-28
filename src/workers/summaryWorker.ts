// src/workers/summaryWorker.ts
import { Pool } from 'pg';

export async function runSummaryWorker(pool: Pool, options?: { fullHistory?: boolean; days?: number }) {
const mode = options?.fullHistory ? 'ALL HISTORY' : `LAST ${options?.days || 7} DAYS`;
  console.log(`📊 Starting daily summary worker (${mode})...`);

  // Build date filter based on mode
  const dateFilter = options?.fullHistory
    ? '' // No date filter = process all data
    : `AND rs.started_at >= CURRENT_DATE - INTERVAL '${options?.days || 7} days'`;

  console.log('📊 Starting daily summary worker (time-based operating mode tracking)...');
  const query = `
    WITH thermostat_mode_periods AS (
      -- Calculate duration for each thermostat_mode setting
      -- Duration = time until next mode change (or current time if no next change)
      -- Filter out invalid sensor readings (e.g., -500)
      SELECT
        ee.device_key,
        d.timezone,
        ee.thermostat_mode,
        ee.recorded_at as period_start,
        LEAD(ee.recorded_at) OVER (PARTITION BY ee.device_key ORDER BY ee.recorded_at) as period_end,
        CASE
          WHEN ee.last_temperature::NUMERIC <= 0 OR ee.last_temperature::NUMERIC < -100 OR ee.last_temperature::NUMERIC > 200 THEN NULL
          ELSE ee.last_temperature
        END as last_temperature,
        CASE
          WHEN ee.last_humidity::NUMERIC <= 0 THEN NULL
          ELSE ee.last_humidity
        END as last_humidity
      FROM equipment_events ee
      INNER JOIN devices d ON d.device_key = ee.device_key
      WHERE (ee.last_temperature IS NULL
             OR (ee.last_temperature::NUMERIC > 0 AND ee.last_temperature::NUMERIC > -100 AND ee.last_temperature::NUMERIC < 200))
        AND (ee.last_humidity IS NULL OR ee.last_humidity::NUMERIC > 0)
        ${dateFilter ? dateFilter.replace('rs.started_at', 'ee.recorded_at') : ''}
    ),
    thermostat_mode_daily AS (
      -- Calculate seconds spent in each mode per day (using device's local timezone)
      -- FIX: Use single AT TIME ZONE for timestamptz columns
      SELECT
        device_key,
        DATE(period_start AT TIME ZONE COALESCE(timezone, 'UTC')) as date,
        thermostat_mode,
        SUM(
          CASE
            -- If period has no end (most recent setting), don't count it yet
            WHEN period_end IS NULL THEN 0
            -- Use full duration of the period
            ELSE EXTRACT(EPOCH FROM (period_end - period_start))::INT
          END
        )::INT as mode_duration_seconds,
        AVG(last_temperature)::NUMERIC as avg_temperature,
        AVG(last_humidity)::NUMERIC as avg_humidity
      FROM thermostat_mode_periods
      GROUP BY device_key, DATE(period_start AT TIME ZONE COALESCE(timezone, 'UTC')), thermostat_mode
    ),
    all_event_dates AS (
      -- Capture ALL dates with equipment events (even idle days) using device's local timezone
      -- FIX: Use single AT TIME ZONE for timestamptz columns
      SELECT DISTINCT
        ee.device_key,
        DATE(ee.recorded_at AT TIME ZONE COALESCE(d.timezone, 'UTC')) as date,
        AVG(CASE
          WHEN ee.last_temperature::NUMERIC > 0 AND ee.last_temperature::NUMERIC > -100 AND ee.last_temperature::NUMERIC < 200
          THEN ee.last_temperature::NUMERIC
          ELSE NULL
        END) as avg_temperature,
        AVG(CASE
          WHEN ee.last_humidity::NUMERIC > 0
          THEN ee.last_humidity::NUMERIC
          ELSE NULL
        END) as avg_humidity
      FROM equipment_events ee
      INNER JOIN devices d ON d.device_key = ee.device_key
      WHERE 1=1
        ${dateFilter ? dateFilter.replace('rs.started_at', 'ee.recorded_at') : ''}
      GROUP BY ee.device_key, DATE(ee.recorded_at AT TIME ZONE COALESCE(d.timezone, 'UTC'))
    ),
    equipment_runtime_daily AS (
      -- Keep existing HVAC equipment runtime calculation (using device's local timezone)
      -- FIX: Use single AT TIME ZONE for timestamptz columns to correctly convert to local time
      -- Double AT TIME ZONE was incorrectly interpreting UTC values as local time
      SELECT
        rs.device_key,
        DATE(COALESCE(rs.ended_at, rs.started_at) AT TIME ZONE COALESCE(d.timezone, 'UTC')) as date,
        SUM(COALESCE(rs.runtime_seconds, 0))::INT as runtime_seconds_total,
        SUM(CASE WHEN rs.mode = 'heat' THEN COALESCE(rs.runtime_seconds, 0) ELSE 0 END)::INT as runtime_seconds_heat,
        SUM(CASE WHEN rs.mode = 'cool' THEN COALESCE(rs.runtime_seconds, 0) ELSE 0 END)::INT as runtime_seconds_cool,
        SUM(CASE WHEN rs.mode = 'fan' THEN COALESCE(rs.runtime_seconds, 0) ELSE 0 END)::INT as runtime_seconds_fan,
        SUM(CASE WHEN rs.mode = 'auxheat' THEN COALESCE(rs.runtime_seconds, 0) ELSE 0 END)::INT as runtime_seconds_auxheat,
        SUM(CASE WHEN rs.mode NOT IN ('heat', 'cool', 'fan', 'auxheat') OR rs.mode IS NULL THEN COALESCE(rs.runtime_seconds, 0) ELSE 0 END)::INT as runtime_seconds_unknown,
        COUNT(*)::INT as runtime_sessions_count
      FROM runtime_sessions rs
      INNER JOIN devices d ON d.device_key = rs.device_key
      WHERE rs.ended_at IS NOT NULL
        ${dateFilter.replace('rs.started_at', 'rs.ended_at')}
      GROUP BY rs.device_key, DATE(COALESCE(rs.ended_at, rs.started_at) AT TIME ZONE COALESCE(d.timezone, 'UTC'))
    ),
    daily AS (
      SELECT
        d.device_id,
        aed.date as date,
        -- HVAC Mode Breakdown (what equipment was DOING - from runtime_sessions)
        COALESCE(erd.runtime_seconds_total, 0)::INT as runtime_seconds_total,
        COALESCE(erd.runtime_seconds_heat, 0)::INT as runtime_seconds_heat,
        COALESCE(erd.runtime_seconds_cool, 0)::INT as runtime_seconds_cool,
        COALESCE(erd.runtime_seconds_fan, 0)::INT as runtime_seconds_fan,
        COALESCE(erd.runtime_seconds_auxheat, 0)::INT as runtime_seconds_auxheat,
        COALESCE(erd.runtime_seconds_unknown, 0)::INT as runtime_seconds_unknown,
        -- Operating Mode Distribution (what user SET thermostat to - from equipment_events)
        SUM(CASE WHEN tmd.thermostat_mode = 'heat' THEN COALESCE(tmd.mode_duration_seconds, 0) ELSE 0 END)::INT as runtime_seconds_mode_heat,
        SUM(CASE WHEN tmd.thermostat_mode = 'cool' THEN COALESCE(tmd.mode_duration_seconds, 0) ELSE 0 END)::INT as runtime_seconds_mode_cool,
        SUM(CASE WHEN tmd.thermostat_mode IN ('auto', 'heat-cool') THEN COALESCE(tmd.mode_duration_seconds, 0) ELSE 0 END)::INT as runtime_seconds_mode_auto,
        SUM(CASE WHEN tmd.thermostat_mode = 'off' THEN COALESCE(tmd.mode_duration_seconds, 0) ELSE 0 END)::INT as runtime_seconds_mode_off,
        SUM(CASE WHEN tmd.thermostat_mode IN ('away', 'vacation') THEN COALESCE(tmd.mode_duration_seconds, 0) ELSE 0 END)::INT as runtime_seconds_mode_away,
        SUM(CASE WHEN tmd.thermostat_mode IN ('eco', 'energy_saver') THEN COALESCE(tmd.mode_duration_seconds, 0) ELSE 0 END)::INT as runtime_seconds_mode_eco,
        SUM(CASE WHEN tmd.thermostat_mode NOT IN ('heat', 'cool', 'auto', 'heat-cool', 'off', 'away', 'vacation', 'eco', 'energy_saver') AND tmd.thermostat_mode IS NOT NULL THEN COALESCE(tmd.mode_duration_seconds, 0) ELSE 0 END)::INT as runtime_seconds_mode_other,
        COALESCE(erd.runtime_sessions_count, 0)::INT as runtime_sessions_count,
        -- Use all_event_dates for temperature/humidity (already filtered for valid temps)
        aed.avg_temperature::NUMERIC as avg_temperature,
        aed.avg_humidity::NUMERIC as avg_humidity
      FROM devices d
      INNER JOIN all_event_dates aed ON aed.device_key = d.device_key
      LEFT JOIN equipment_runtime_daily erd ON erd.device_key = d.device_key AND erd.date = aed.date
      LEFT JOIN thermostat_mode_daily tmd ON tmd.device_key = d.device_key AND tmd.date = aed.date
      WHERE d.device_id IS NOT NULL
      GROUP BY d.device_id, aed.date, erd.runtime_seconds_total, erd.runtime_seconds_heat,
               erd.runtime_seconds_cool, erd.runtime_seconds_fan, erd.runtime_seconds_auxheat,
               erd.runtime_seconds_unknown, erd.runtime_sessions_count, aed.avg_temperature, aed.avg_humidity
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
