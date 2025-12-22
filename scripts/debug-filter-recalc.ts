import { pool } from '../src/db/pool';

const deviceKey = process.argv[2];

async function debugFilterRecalc() {
  if (!deviceKey) {
    console.log('Usage: npx ts-node scripts/debug-filter-recalc.ts <device_key>');
    console.log('\nAvailable devices:');
    const devices = await pool.query(
      `SELECT device_key, device_name, use_forced_air_for_heat FROM devices ORDER BY device_name LIMIT 20`
    );
    for (const d of devices.rows) {
      console.log(`  ${d.device_key} - ${d.device_name} (forced_air=${d.use_forced_air_for_heat})`);
    }
    process.exit(1);
  }

  console.log(`\n🔍 Debugging filter recalculation for device: ${deviceKey}\n`);

  // 1. Get device info
  const deviceResult = await pool.query(
    `SELECT device_key, device_name, use_forced_air_for_heat, filter_target_hours, filter_usage_percent
     FROM devices WHERE device_key = $1`,
    [deviceKey]
  );

  if (deviceResult.rows.length === 0) {
    console.log('❌ Device not found');
    process.exit(1);
  }

  const device = deviceResult.rows[0];
  console.log('📱 Device:');
  console.log(`   Name: ${device.device_name}`);
  console.log(`   use_forced_air_for_heat: ${device.use_forced_air_for_heat}`);
  console.log(`   filter_target_hours: ${device.filter_target_hours}`);
  console.log(`   filter_usage_percent: ${device.filter_usage_percent}%`);

  // 2. Get device_states
  const stateResult = await pool.query(
    `SELECT hours_used_total, filter_hours_used, last_reset_ts, last_event_ts
     FROM device_states WHERE device_key = $1`,
    [deviceKey]
  );

  if (stateResult.rows.length === 0) {
    console.log('\n❌ No device_states record found');
    process.exit(1);
  }

  const state = stateResult.rows[0];
  console.log('\n📊 Device State:');
  console.log(`   hours_used_total: ${state.hours_used_total} hours`);
  console.log(`   filter_hours_used: ${state.filter_hours_used} hours`);
  console.log(`   last_reset_ts: ${state.last_reset_ts || 'NULL (never reset)'}`);
  console.log(`   last_event_ts: ${state.last_event_ts}`);

  // 3. Count all runtime_sessions
  const allSessionsResult = await pool.query(
    `SELECT
       COUNT(*) as total_sessions,
       SUM(runtime_seconds) / 3600.0 as total_hours,
       MIN(ended_at) as earliest,
       MAX(ended_at) as latest
     FROM runtime_sessions
     WHERE device_key = $1 AND ended_at IS NOT NULL`,
    [deviceKey]
  );

  const allSessions = allSessionsResult.rows[0];
  console.log('\n⏱️  All Runtime Sessions:');
  console.log(`   Total sessions: ${allSessions.total_sessions}`);
  console.log(`   Total hours: ${parseFloat(allSessions.total_hours || 0).toFixed(2)}`);
  console.log(`   Date range: ${allSessions.earliest} to ${allSessions.latest}`);

  // 4. Count sessions since last_reset_ts
  if (state.last_reset_ts) {
    const sinceResetResult = await pool.query(
      `SELECT
         COUNT(*) as total_sessions,
         SUM(runtime_seconds) / 3600.0 as total_hours
       FROM runtime_sessions
       WHERE device_key = $1 AND ended_at IS NOT NULL AND ended_at >= $2`,
      [deviceKey, state.last_reset_ts]
    );

    const sinceReset = sinceResetResult.rows[0];
    console.log('\n⏱️  Sessions SINCE last_reset_ts:');
    console.log(`   Total sessions: ${sinceReset.total_sessions}`);
    console.log(`   Total hours: ${parseFloat(sinceReset.total_hours || 0).toFixed(2)}`);
  }

  // 5. Breakdown by equipment_status
  let breakdownResult;
  if (state.last_reset_ts) {
    breakdownResult = await pool.query(
      `SELECT equipment_status, COUNT(*) as count, SUM(runtime_seconds) / 3600.0 as hours
       FROM runtime_sessions
       WHERE device_key = $1 AND ended_at IS NOT NULL AND ended_at >= $2
       GROUP BY equipment_status ORDER BY hours DESC`,
      [deviceKey, state.last_reset_ts]
    );
  } else {
    breakdownResult = await pool.query(
      `SELECT equipment_status, COUNT(*) as count, SUM(runtime_seconds) / 3600.0 as hours
       FROM runtime_sessions
       WHERE device_key = $1 AND ended_at IS NOT NULL
       GROUP BY equipment_status ORDER BY hours DESC`,
      [deviceKey]
    );
  }

  console.log('\n📋 Breakdown by equipment_status (since reset):');
  let filterTotal = 0;
  for (const row of breakdownResult.rows) {
    const status = row.equipment_status || 'NULL';
    const hours = parseFloat(row.hours || 0);

    // Check if this counts toward filter
    const countsFilter = shouldCountTowardFilter(status, device.use_forced_air_for_heat);
    const marker = countsFilter ? '✓ FILTER' : '✗';

    if (countsFilter) filterTotal += hours;

    console.log(`   ${status}: ${hours.toFixed(2)}h (${row.count} sessions) ${marker}`);
  }

  console.log(`\n📈 Calculated filter_hours_used: ${filterTotal.toFixed(2)} hours`);
  console.log(`   Current stored value: ${state.filter_hours_used} hours`);

  await pool.end();
  process.exit(0);
}

function shouldCountTowardFilter(equipment_status: string | null, use_forced_air_for_heat: boolean | null): boolean {
  if (!equipment_status) return false;

  const status = equipment_status.toLowerCase();

  // Always count cooling and fan-only operations
  if (status.includes('cool') || status.includes('fan')) {
    return true;
  }

  // For heating and aux heat
  if (status.includes('heat')) {
    // If has _Fan suffix, always count
    if (status.includes('_fan') || status.endsWith('fan')) {
      return true;
    }

    // Otherwise, only count if use_forced_air_for_heat is true
    return use_forced_air_for_heat === true;
  }

  return false;
}

debugFilterRecalc().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
