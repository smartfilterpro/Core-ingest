import { pool } from '../src/db/pool';

const deviceKey = '48A2E683C449';

async function checkDevice() {
  console.log(`\n🔍 Checking device: ${deviceKey}\n`);

  try {
    // 1. Check if device exists
    const deviceQuery = await pool.query(
      `SELECT device_key, device_id, device_name, filter_target_hours, filter_usage_percent,
              use_forced_air_for_heat, created_at, updated_at
       FROM devices
       WHERE device_key = $1`,
      [deviceKey]
    );

    if (deviceQuery.rows.length === 0) {
      console.log('❌ Device not found in devices table');
      process.exit(1);
    }

    const device = deviceQuery.rows[0];
    console.log('✅ Device found:');
    console.log(JSON.stringify(device, null, 2));

    // 2. Check device_states
    console.log('\n📊 Checking device_states...');
    const stateQuery = await pool.query(
      `SELECT device_key, last_event_ts, open_session_id, is_active,
              hours_used_total, filter_hours_used, last_reset_ts, created_at, updated_at
       FROM device_states
       WHERE device_key = $1`,
      [deviceKey]
    );

    if (stateQuery.rows.length === 0) {
      console.log('⚠️  No device_states record found');
    } else {
      console.log(JSON.stringify(stateQuery.rows[0], null, 2));
    }

    // 3. Check runtime_sessions count
    console.log('\n⏱️  Checking runtime_sessions...');
    const sessionsQuery = await pool.query(
      `SELECT COUNT(*) as total_sessions,
              SUM(runtime_seconds) as total_runtime_seconds,
              MIN(started_at) as earliest_session,
              MAX(started_at) as latest_session
       FROM runtime_sessions
       WHERE device_key = $1`,
      [deviceKey]
    );

    console.log(JSON.stringify(sessionsQuery.rows[0], null, 2));

    // 4. Check summaries_daily
    console.log('\n📈 Checking summaries_daily...');
    const summariesQuery = await pool.query(
      `SELECT COUNT(*) as total_days,
              SUM(runtime_seconds_total) as total_runtime_seconds,
              MIN(date) as earliest_date,
              MAX(date) as latest_date,
              MAX(updated_at) as last_updated
       FROM summaries_daily
       WHERE device_id = $1`,
      [device.device_id]
    );

    console.log(JSON.stringify(summariesQuery.rows[0], null, 2));

    // 5. Check recent equipment_events
    console.log('\n📡 Checking recent equipment_events...');
    const eventsQuery = await pool.query(
      `SELECT COUNT(*) as total_events,
              MIN(recorded_at) as earliest_event,
              MAX(recorded_at) as latest_event
       FROM equipment_events
       WHERE device_key = $1`,
      [deviceKey]
    );

    console.log(JSON.stringify(eventsQuery.rows[0], null, 2));

    // 6. Check last 5 equipment events
    console.log('\n📋 Last 5 equipment events:');
    const recentEventsQuery = await pool.query(
      `SELECT id, equipment_status, is_active, recorded_at, runtime_seconds, previous_status
       FROM equipment_events
       WHERE device_key = $1
       ORDER BY recorded_at DESC
       LIMIT 5`,
      [deviceKey]
    );

    console.log(JSON.stringify(recentEventsQuery.rows, null, 2));

    // 7. Check last 5 runtime sessions
    console.log('\n⏲️  Last 5 runtime sessions:');
    const recentSessionsQuery = await pool.query(
      `SELECT session_id, mode, equipment_status, started_at, ended_at,
              runtime_seconds, terminated_reason
       FROM runtime_sessions
       WHERE device_key = $1
       ORDER BY started_at DESC
       LIMIT 5`,
      [deviceKey]
    );

    console.log(JSON.stringify(recentSessionsQuery.rows, null, 2));

    // 8. Check last 5 daily summaries
    console.log('\n📅 Last 5 daily summaries:');
    const recentSummariesQuery = await pool.query(
      `SELECT date, runtime_seconds_total, runtime_sessions_count,
              avg_temperature, updated_at
       FROM summaries_daily
       WHERE device_id = $1
       ORDER BY date DESC
       LIMIT 5`,
      [device.device_id]
    );

    console.log(JSON.stringify(recentSummariesQuery.rows, null, 2));

    console.log('\n✅ Device check complete\n');
    process.exit(0);
  } catch (err: any) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

checkDevice();
