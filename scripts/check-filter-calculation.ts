import { pool } from '../src/db/pool';

const deviceKey = '5CFCE18CEAD7';

async function checkFilterCalculation() {
  console.log(`\n🔍 Checking filter calculation for device: ${deviceKey}\n`);

  try {
    // 1. Get device record with current filter_usage_percent
    const deviceQuery = await pool.query(
      `SELECT
        device_key,
        device_id,
        device_name,
        filter_target_hours,
        filter_usage_percent,
        use_forced_air_for_heat,
        updated_at
       FROM devices
       WHERE device_key = $1`,
      [deviceKey]
    );

    if (deviceQuery.rows.length === 0) {
      console.log('❌ Device not found in devices table');
      process.exit(1);
    }

    const device = deviceQuery.rows[0];
    console.log('📱 Device Record:');
    console.log(`   device_key: ${device.device_key}`);
    console.log(`   device_id: ${device.device_id}`);
    console.log(`   device_name: ${device.device_name}`);
    console.log(`   filter_target_hours: ${device.filter_target_hours}`);
    console.log(`   filter_usage_percent: ${device.filter_usage_percent}%`);
    console.log(`   use_forced_air_for_heat: ${device.use_forced_air_for_heat}`);
    console.log(`   updated_at: ${device.updated_at}`);

    // 2. Get device_states with runtime data
    console.log('\n📊 Device States:');
    const stateQuery = await pool.query(
      `SELECT
        device_key,
        hours_used_total,
        filter_hours_used,
        last_event_ts,
        last_reset_ts,
        is_active,
        open_session_id,
        updated_at
       FROM device_states
       WHERE device_key = $1`,
      [deviceKey]
    );

    if (stateQuery.rows.length === 0) {
      console.log('   ⚠️  No device_states record found');
    } else {
      const state = stateQuery.rows[0];
      console.log(`   hours_used_total: ${state.hours_used_total} hours`);
      console.log(`   filter_hours_used: ${state.filter_hours_used} hours`);
      console.log(`   last_event_ts: ${state.last_event_ts}`);
      console.log(`   last_reset_ts: ${state.last_reset_ts}`);
      console.log(`   is_active: ${state.is_active}`);
      console.log(`   open_session_id: ${state.open_session_id}`);
      console.log(`   updated_at: ${state.updated_at}`);

      // 3. Calculate what filter_usage_percent SHOULD be
      console.log('\n🧮 Expected Calculation:');
      const expectedPercent = Math.min(
        100,
        Math.round((parseFloat(state.filter_hours_used) / parseFloat(device.filter_target_hours)) * 100)
      );
      console.log(`   Formula: (filter_hours_used / filter_target_hours) * 100`);
      console.log(`   = (${state.filter_hours_used} / ${device.filter_target_hours}) * 100`);
      console.log(`   = ${(parseFloat(state.filter_hours_used) / parseFloat(device.filter_target_hours) * 100).toFixed(4)}%`);
      console.log(`   = ${expectedPercent}% (rounded)`);

      console.log('\n📈 Comparison:');
      console.log(`   Current filter_usage_percent: ${device.filter_usage_percent}%`);
      console.log(`   Expected filter_usage_percent: ${expectedPercent}%`);

      if (device.filter_usage_percent === expectedPercent) {
        console.log(`   ✅ Match - Calculation is correct!`);
      } else {
        console.log(`   ❌ MISMATCH - Calculation is incorrect!`);
        console.log(`   Difference: ${Math.abs(device.filter_usage_percent - expectedPercent)}%`);
      }
    }

    // 4. Check runtime_sessions totals
    console.log('\n⏱️  Runtime Sessions Analysis:');
    const sessionsQuery = await pool.query(
      `SELECT
        COUNT(*) as total_sessions,
        SUM(runtime_seconds) as total_runtime_seconds,
        SUM(runtime_seconds) / 3600.0 as total_runtime_hours,
        MIN(started_at) as earliest_session,
        MAX(started_at) as latest_session,
        SUM(CASE WHEN mode = 'heat' THEN runtime_seconds ELSE 0 END) / 3600.0 as heat_hours,
        SUM(CASE WHEN mode = 'cool' THEN runtime_seconds ELSE 0 END) / 3600.0 as cool_hours,
        SUM(CASE WHEN mode = 'fan' THEN runtime_seconds ELSE 0 END) / 3600.0 as fan_hours
       FROM runtime_sessions
       WHERE device_key = $1`,
      [deviceKey]
    );

    const sessions = sessionsQuery.rows[0];
    console.log(`   Total sessions: ${sessions.total_sessions}`);
    console.log(`   Total runtime: ${parseFloat(sessions.total_runtime_hours || 0).toFixed(2)} hours`);
    console.log(`   Heat: ${parseFloat(sessions.heat_hours || 0).toFixed(2)} hours`);
    console.log(`   Cool: ${parseFloat(sessions.cool_hours || 0).toFixed(2)} hours`);
    console.log(`   Fan: ${parseFloat(sessions.fan_hours || 0).toFixed(2)} hours`);
    console.log(`   Earliest: ${sessions.earliest_session}`);
    console.log(`   Latest: ${sessions.latest_session}`);

    // 5. Check summaries_daily totals
    console.log('\n📅 Daily Summaries Analysis:');
    const summariesQuery = await pool.query(
      `SELECT
        COUNT(*) as total_days,
        SUM(runtime_seconds_total) as total_runtime_seconds,
        SUM(runtime_seconds_total) / 3600.0 as total_runtime_hours,
        MIN(date) as earliest_date,
        MAX(date) as latest_date
       FROM summaries_daily
       WHERE device_id = $1`,
      [device.device_id]
    );

    const summaries = summariesQuery.rows[0];
    console.log(`   Total days: ${summaries.total_days}`);
    console.log(`   Total runtime: ${parseFloat(summaries.total_runtime_hours || 0).toFixed(2)} hours`);
    console.log(`   Earliest: ${summaries.earliest_date}`);
    console.log(`   Latest: ${summaries.latest_date}`);

    // 6. Check for discrepancies
    console.log('\n🔎 Discrepancy Analysis:');
    const stateHours = parseFloat(stateQuery.rows[0]?.hours_used_total || 0);
    const sessionHours = parseFloat(sessions.total_runtime_hours || 0);
    const summaryHours = parseFloat(summaries.total_runtime_hours || 0);

    console.log(`   device_states.hours_used_total: ${stateHours.toFixed(2)} hours`);
    console.log(`   runtime_sessions total: ${sessionHours.toFixed(2)} hours`);
    console.log(`   summaries_daily total: ${summaryHours.toFixed(2)} hours`);

    if (Math.abs(stateHours - sessionHours) > 0.1) {
      console.log(`   ⚠️  WARNING: device_states doesn't match runtime_sessions!`);
      console.log(`      Difference: ${Math.abs(stateHours - sessionHours).toFixed(2)} hours`);
    }

    // 7. Recent sessions with equipment status
    console.log('\n📋 Last 10 Runtime Sessions (with filter status):');
    const recentSessionsQuery = await pool.query(
      `SELECT
        session_id,
        mode,
        equipment_status,
        started_at,
        ended_at,
        runtime_seconds,
        runtime_seconds / 3600.0 as runtime_hours,
        terminated_reason
       FROM runtime_sessions
       WHERE device_key = $1
       ORDER BY started_at DESC
       LIMIT 10`,
      [deviceKey]
    );

    for (const session of recentSessionsQuery.rows) {
      const countsFilter = shouldCountTowardFilter(
        session.equipment_status,
        device.use_forced_air_for_heat
      );
      console.log(`   ${session.started_at} | ${session.equipment_status || session.mode} | ${parseFloat(session.runtime_hours).toFixed(2)}h | Filter: ${countsFilter ? '✓' : '✗'}`);
    }

    console.log('\n✅ Analysis complete\n');
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

// Helper function to determine if runtime counts toward filter
function shouldCountTowardFilter(
  equipment_status: string | null,
  use_forced_air_for_heat: boolean | null
): boolean {
  if (!equipment_status) return false;

  const status = equipment_status.toLowerCase();

  // Always count cooling and fan-only operations
  if (status.includes('cool') || status.includes('fan')) {
    return true;
  }

  // For heating and aux heat
  if (status.includes('heat')) {
    // If has _Fan suffix (case insensitive), always count
    if (status.includes('_fan') || status.endsWith('fan')) {
      return true;
    }

    // Otherwise, only count if use_forced_air_for_heat is true
    return use_forced_air_for_heat === true;
  }

  return false;
}

checkFilterCalculation();
