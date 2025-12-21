import { pool } from "../db/pool";
import { PoolClient } from "pg";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);

type SessionRow = {
  session_id: string;
  device_key: string;
  started_at: string | null;
  ended_at: string | null;
  runtime_seconds: number | null;
  mode: string | null;
  equipment_status: string | null;
  start_temperature: number | null;
  end_temperature: number | null;
  heat_setpoint: number | null;
  cool_setpoint: number | null;
  tick_count: number | null;
  last_tick_at: string | null;
};

type DeviceStateRow = {
  device_key: string;
  last_event_ts: string | null;
  open_session_id: string | null;
  is_active: boolean;
  hours_used_total: number;
  filter_hours_used: number;
  last_reset_ts: string | null;
};

const ACTIVE_STATUSES = new Set([
  "heat",
  "heating",
  "cool",
  "cooling",
  "fan",
  "fan_only",
  "fan-on",
  "fanstart",
  "running",
]);

const LAST_FAN_TAIL_SECONDS = parseInt(
  process.env.LAST_FAN_TAIL_SECONDS || "180"
);

function toBoolActive(
  equipment_status: string | null,
  is_active: boolean | null
): boolean {
  if (typeof is_active === "boolean") return is_active;
  if (!equipment_status) return false;
  const norm = equipment_status.toLowerCase();
  return ACTIVE_STATUSES.has(norm);
}

function deriveMode(
  equipment_status: string | null,
  mode: string | null
): string {
  const src = (equipment_status || mode || "unknown").toLowerCase();
  if (src.includes("heat")) return "heat";
  if (src.includes("cool")) return "cool";
  if (src.includes("fan")) return "fan";
  return "unknown";
}

/**
 * Determines if a runtime session should count toward filter usage.
 *
 * Rules:
 * 1. Always count: Cooling, Cooling_Fan, Fan, Fan_only
 * 2. If use_forced_air_for_heat = true: Count all Heating/AuxHeat
 * 3. If use_forced_air_for_heat = false: Only count Heating_Fan, AuxHeat_Fan
 *
 * @param equipment_status - The equipment status (e.g., "Heating", "Heating_Fan", "Cooling", "Fan_only")
 * @param use_forced_air_for_heat - Device setting for forced air during heating
 * @returns true if this runtime counts toward filter usage
 */
function countsTowardFilter(
  equipment_status: string | null,
  use_forced_air_for_heat: boolean | null
): boolean {
  if (!equipment_status) return false;

  const status = equipment_status.toLowerCase();

  // Always count cooling and fan-only operations
  if (status.includes("cool") || status.includes("fan")) {
    return true;
  }

  // For heating and aux heat
  if (status.includes("heat")) {
    // If has _Fan suffix (case insensitive), always count
    if (status.includes("_fan") || status.endsWith("fan")) {
      return true;
    }

    // Otherwise, only count if use_forced_air_for_heat is true
    return use_forced_air_for_heat === true;
  }

  return false;
}

export async function runSessionStitcher() {
  console.log("[sessionStitcher] Starting session stitching...");
  const client = await pool.connect();
  let devicesProcessed = 0;

  try {
    await client.query("BEGIN");

    const devices = await client.query(`SELECT device_key FROM devices`);
    
    for (const d of devices.rows) {
      await stitchDevice(client, d.device_key, LAST_FAN_TAIL_SECONDS);
      devicesProcessed++;
    }

    // Recalculate filter_usage_percent for all devices
    // This ensures devices stay in sync even without new events
    const recalcResult = await client.query(`
      UPDATE devices d
      SET filter_usage_percent = LEAST(
        100,
        ROUND((ds.filter_hours_used / NULLIF(d.filter_target_hours, 0)) * 100)
      ),
      updated_at = NOW()
      FROM device_states ds
      WHERE d.device_key = ds.device_key
        AND d.filter_target_hours > 0
    `);

    console.log(
      `[sessionStitcher] Recalculated filter_usage_percent for ${recalcResult.rowCount} devices`
    );

    await client.query("COMMIT");
    console.log(
      `[sessionStitcher] [OK] Completed (${devicesProcessed} devices processed)`
    );

    return {
      ok: true,
      devices_processed: devicesProcessed,
      success: true,
    };
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("[sessionStitcher] [ERROR]", err.message);
    return {
      ok: false,
      error: err.message,
      success: false,
    };
  } finally {
    client.release();
  }
}

async function ensureDeviceState(
  client: PoolClient,
  device_key: string
): Promise<DeviceStateRow> {
  const { rows } = await client.query(
    `
    SELECT device_key, last_event_ts, open_session_id, is_active,
           hours_used_total, COALESCE(filter_hours_used, 0) as filter_hours_used, last_reset_ts
    FROM device_states WHERE device_key = $1
  `,
    [device_key]
  );

  if (rows[0]) return rows[0];

  await client.query(
    `
    INSERT INTO device_states (device_key, last_event_ts, open_session_id, is_active, hours_used_total, filter_hours_used, last_reset_ts)
    VALUES ($1, NULL, NULL, false, 0, 0, NULL)
    ON CONFLICT (device_key) DO NOTHING
  `,
    [device_key]
  );

  const reread = await client.query(
    `
    SELECT device_key, last_event_ts, open_session_id, is_active,
           hours_used_total, COALESCE(filter_hours_used, 0) as filter_hours_used, last_reset_ts
    FROM device_states WHERE device_key = $1
  `,
    [device_key]
  );

  return reread.rows[0];
}

/**
 * Process an event that includes runtime_seconds.
 * Creates a completed session directly from the posted runtime data.
 * Uses previous_status if available, otherwise falls back to equipment_status.
 */
async function processRuntimeEvent(
  client: PoolClient,
  device_key: string,
  event: any,
  state: DeviceStateRow
) {
  const runtime_seconds = event.runtime_seconds;
  const recorded_at = event.recorded_at;

  // Use previous_status if available, otherwise fall back to equipment_status
  const status = event.previous_status || event.equipment_status;

  if (!status || runtime_seconds <= 0) return;

  // Derive mode from status (what it WAS doing)
  const mode = deriveMode(status, null);

  // Calculate timestamps for the session
  const ended_at = dayjs.utc(recorded_at).toISOString();
  const started_at = dayjs.utc(recorded_at).subtract(runtime_seconds, 'second').toISOString();

  // Get device settings for filter calculation
  const deviceSettings = await client.query<{
    device_id: string;
    use_forced_air_for_heat: boolean | null;
    filter_target_hours: number;
  }>(
    `SELECT device_id, use_forced_air_for_heat, COALESCE(filter_target_hours, 100) as filter_target_hours
     FROM devices WHERE device_key = $1`,
    [device_key]
  );

  const device = deviceSettings.rows[0];
  if (!device) return;

  // Create completed session
  await client.query(
    `INSERT INTO runtime_sessions (
      device_key, mode, equipment_status, started_at, ended_at,
      runtime_seconds, tick_count, terminated_reason, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'posted_runtime', NOW(), NOW())`,
    [device_key, mode, status, started_at, ended_at, runtime_seconds]
  );

  // Calculate filter hours
  const addHours = runtime_seconds / 3600.0;
  const lastReset = state.last_reset_ts ? dayjs.utc(state.last_reset_ts) : null;

  let newHours = parseFloat(String(state.hours_used_total || 0)) + addHours;
  let filterHoursToAdd = addHours;

  // Adjust if session started before last reset
  if (lastReset && dayjs.utc(started_at).isBefore(lastReset)) {
    const postResetDur = Math.max(0, dayjs.utc(ended_at).diff(lastReset, "second"));
    newHours = parseFloat(String(state.hours_used_total || 0)) + postResetDur / 3600.0;
    filterHoursToAdd = postResetDur / 3600.0;
  }

  // Apply filter logic to status (what was actually running)
  const shouldCountFilter = countsTowardFilter(status, device.use_forced_air_for_heat);

  if (!shouldCountFilter) {
    filterHoursToAdd = 0;
  }

  const newFilterHours = parseFloat(String(state.filter_hours_used || 0)) + filterHoursToAdd;

  // Calculate filter usage percentage
  const filter_usage_percent = Math.min(
    100,
    Math.round((newFilterHours / device.filter_target_hours) * 100)
  );

  // Update device_states
  await client.query(
    `UPDATE device_states
     SET hours_used_total = $1,
         filter_hours_used = $2,
         last_event_ts = $3,
         updated_at = NOW()
     WHERE device_key = $4`,
    [newHours, newFilterHours, recorded_at, device_key]
  );

  // Update filter_usage_percent in devices table
  await client.query(
    `UPDATE devices
     SET filter_usage_percent = $1, updated_at = NOW()
     WHERE device_key = $2`,
    [filter_usage_percent, device_key]
  );

  console.log(
    `[sessionStitcher] Device ${device_key}: +${addHours.toFixed(2)}h total, ` +
    `+${filterHoursToAdd.toFixed(2)}h filter (${shouldCountFilter ? status : "excluded"}), ` +
    `usage: ${filter_usage_percent}% [POSTED]`
  );

  // Update state object
  state.hours_used_total = newHours;
  state.filter_hours_used = newFilterHours;
  state.last_event_ts = recorded_at;
}

async function stitchDevice(
  client: PoolClient,
  device_key: string,
  tailSeconds: number
) {
  // Load state
  let state = await ensureDeviceState(client, device_key);

  // Pull new events since last_event_ts
  const evs = await client.query(
    `
    SELECT id, equipment_status, is_active, recorded_at, runtime_seconds, previous_status
    FROM equipment_events
    WHERE device_key = $1
      AND ($2::timestamptz IS NULL OR recorded_at > $2)
    ORDER BY recorded_at ASC
  `,
    [device_key, state.last_event_ts]
  );

  if (evs.rows.length === 0) {
    // Close stale open session if tail has elapsed
    await maybeCloseStale(client, device_key, state, tailSeconds);
    return;
  }

  for (const e of evs.rows) {
    const ts = dayjs.utc(e.recorded_at);

    // PRIORITY: If event includes runtime_seconds, use posted data (more accurate)
    // processRuntimeEvent will use previous_status if available, otherwise equipment_status
    if (e.runtime_seconds && e.runtime_seconds > 0) {
      await processRuntimeEvent(client, device_key, e, state);
      continue; // Skip to next event
    }

    // FALLBACK: Use ON/OFF transition tracking for events without runtime_seconds
    const activeNow = toBoolActive(e.equipment_status, e.is_active);

    if (!state.is_active && activeNow) {
      // Transition OFF -> ON: open new session
      const started_at = ts.toISOString();
      const mode = deriveMode(e.equipment_status, null);
      
      const session = await client.query(
        `
        INSERT INTO runtime_sessions (device_key, mode, equipment_status, started_at, tick_count, last_tick_at, created_at, updated_at)
        VALUES ($1,$2,$3,$4,1,$4,NOW(),NOW())
        RETURNING session_id
      `,
        [device_key, mode, e.equipment_status || mode, started_at]
      );
      
      const sid = session.rows[0].session_id;

      await client.query(
        `
        UPDATE device_states
        SET open_session_id = $1, is_active = true, last_event_ts = $2, updated_at = NOW()
        WHERE device_key = $3
      `,
        [sid, started_at, device_key]
      );

      state.open_session_id = sid;
      state.is_active = true;
      state.last_event_ts = started_at;
      continue;
    }

    if (state.is_active && !activeNow) {
      // Transition ON -> OFF: mark last_event_ts but don't close until tail passes
      const tsISO = ts.toISOString();
      
      await client.query(
        `
        UPDATE device_states
        SET last_event_ts = $1, is_active = false, updated_at = NOW()
        WHERE device_key = $2
      `,
        [tsISO, device_key]
      );
      
      state.is_active = false;
      state.last_event_ts = tsISO;
      continue;
    }

    // If still active, update ticks
    if (state.is_active && state.open_session_id) {
      await client.query(
        `
        UPDATE runtime_sessions
        SET tick_count = COALESCE(tick_count,0) + 1, last_tick_at = $1, updated_at = NOW()
        WHERE session_id = $2
      `,
        [ts.toISOString(), state.open_session_id]
      );
      
      state.last_event_ts = ts.toISOString();
      
      await client.query(
        `
        UPDATE device_states SET last_event_ts = $1, updated_at = NOW()
        WHERE device_key = $2
      `,
        [state.last_event_ts, device_key]
      );
    } else {
      // Inactive steady-state, just advance last_event_ts
      state.last_event_ts = ts.toISOString();
      
      await client.query(
        `
        UPDATE device_states SET last_event_ts = $1, updated_at = NOW()
        WHERE device_key = $2
      `,
        [state.last_event_ts, device_key]
      );
    }
  }

  // After processing batch, close stale sessions if tail elapsed
  await maybeCloseStale(client, device_key, state, tailSeconds);
}

async function maybeCloseStale(
  client: PoolClient,
  device_key: string,
  state: DeviceStateRow,
  tailSeconds: number
) {
  if (!state.open_session_id) return;
  if (state.is_active) return;
  if (!state.last_event_ts) return;

  const lastTs = dayjs.utc(state.last_event_ts);
  const cutoff = lastTs.add(tailSeconds, "second");
  const now = dayjs.utc();

  if (now.isBefore(cutoff)) return;

  // Close session at last_event_ts + tailSeconds
  const ended_at = cutoff.toISOString();

  // Compute duration from session start and get equipment_status
  const sess = await client.query<SessionRow>(
    `
    SELECT session_id, started_at, equipment_status FROM runtime_sessions WHERE session_id = $1
  `,
    [state.open_session_id]
  );

  const sessionData = sess.rows[0];
  if (!sessionData?.started_at) return;

  const started_at = sessionData.started_at;
  const equipment_status = sessionData.equipment_status;

  const calculatedDur = Math.max(
    0,
    dayjs.utc(ended_at).diff(dayjs.utc(started_at), "second")
  );

  // CRITICAL FIX: Reject sessions with unrealistic durations
  // Maximum realistic session: 2 hours (7200 seconds)
  // If polling stopped for a long time, don't create phantom runtime
  const MAX_REASONABLE_SESSION_SECONDS = 7200;  // 2 hours

  if (calculatedDur > MAX_REASONABLE_SESSION_SECONDS) {
    console.warn(
      `[sessionStitcher] REJECTED phantom session for ${device_key}: ` +
      `Duration would be ${Math.round(calculatedDur / 3600)}h ` +
      `(${calculatedDur}s). This indicates a polling gap. ` +
      `Deleting open session without adding runtime.`
    );

    // Delete the bogus session instead of closing it with phantom runtime
    await client.query(
      `DELETE FROM runtime_sessions WHERE session_id = $1`,
      [state.open_session_id]
    );

    // Clear open session from state
    await client.query(
      `UPDATE device_states
       SET open_session_id = NULL, is_active = false, updated_at = NOW()
       WHERE device_key = $1`,
      [device_key]
    );

    // Update local state
    state.open_session_id = null;
    state.is_active = false;

    return; // Don't add any runtime hours
  }

  const dur = calculatedDur;

  await client.query(
    `
    UPDATE runtime_sessions
    SET ended_at = $1, runtime_seconds = $2, updated_at = NOW(), terminated_reason = 'tail_close'
    WHERE session_id = $3
  `,
    [ended_at, dur, state.open_session_id]
  );

  // Get device settings for filter calculation
  const deviceSettings = await client.query<{
    device_id: string;
    use_forced_air_for_heat: boolean | null;
    filter_target_hours: number;
  }>(
    `SELECT device_id, use_forced_air_for_heat, COALESCE(filter_target_hours, 100) as filter_target_hours
     FROM devices WHERE device_key = $1`,
    [device_key]
  );

  const device = deviceSettings.rows[0];
  if (!device) return;

  // Calculate hours to add
  const lastReset = state.last_reset_ts ? dayjs.utc(state.last_reset_ts) : null;
  const addHours = dur / 3600.0;

  let newHours = parseFloat(String(state.hours_used_total || 0)) + addHours;

  // Adjust if session started before last reset
  if (lastReset && dayjs.utc(started_at).isBefore(lastReset)) {
    const postResetDur = Math.max(
      0,
      dayjs.utc(ended_at).diff(lastReset, "second")
    );
    newHours = parseFloat(String(state.hours_used_total || 0)) + postResetDur / 3600.0;
  }

  // Calculate filter-specific hours based on equipment_status and use_forced_air_for_heat
  const shouldCountFilter = countsTowardFilter(
    equipment_status,
    device.use_forced_air_for_heat
  );

  let filterHoursToAdd = shouldCountFilter ? addHours : 0;

  // Adjust filter hours if session started before last reset
  if (lastReset && dayjs.utc(started_at).isBefore(lastReset)) {
    const postResetDur = Math.max(
      0,
      dayjs.utc(ended_at).diff(lastReset, "second")
    );
    filterHoursToAdd = shouldCountFilter ? postResetDur / 3600.0 : 0;
  }

  const newFilterHours = parseFloat(String(state.filter_hours_used || 0)) + filterHoursToAdd;

  // Calculate filter usage percentage
  const filter_usage_percent = Math.min(
    100,
    Math.round((newFilterHours / device.filter_target_hours) * 100)
  );

  // Update device_states with both total and filter hours
  await client.query(
    `
    UPDATE device_states
    SET open_session_id = NULL,
        hours_used_total = $1,
        filter_hours_used = $2,
        updated_at = NOW()
    WHERE device_key = $3
  `,
    [newHours, newFilterHours, device_key]
  );

  // Update filter_usage_percent in devices table
  await client.query(
    `
    UPDATE devices
    SET filter_usage_percent = $1, updated_at = NOW()
    WHERE device_key = $2
  `,
    [filter_usage_percent, device_key]
  );

  console.log(
    `[sessionStitcher] Device ${device_key}: +${addHours.toFixed(2)}h total, ` +
    `+${filterHoursToAdd.toFixed(2)}h filter (${shouldCountFilter ? equipment_status : "excluded"}), ` +
    `usage: ${filter_usage_percent}%`
  );
}

/**
 * Recalculates filter_hours_used for a device based on runtime_sessions.
 * This should be called when use_forced_air_for_heat changes to ensure
 * the filter hours reflect the correct calculation.
 *
 * @param device_key - The device key to recalculate
 * @returns Object with ok status and recalculated values
 */
export async function recalculateFilterHours(device_key: string): Promise<{
  ok: boolean;
  previous_filter_hours?: number;
  new_filter_hours?: number;
  use_forced_air_for_heat?: boolean;
  error?: string;
}> {
  console.log(`[sessionStitcher] Recalculating filter hours for device: ${device_key}`);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Get device settings
    const deviceResult = await client.query<{
      device_id: string;
      use_forced_air_for_heat: boolean | null;
      filter_target_hours: number;
    }>(
      `SELECT device_id, use_forced_air_for_heat, COALESCE(filter_target_hours, 100) as filter_target_hours
       FROM devices WHERE device_key = $1`,
      [device_key]
    );

    if (deviceResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Device not found" };
    }

    const device = deviceResult.rows[0];

    // Get device state for last reset timestamp
    const stateResult = await client.query<{
      filter_hours_used: number;
      last_reset_ts: string | null;
    }>(
      `SELECT COALESCE(filter_hours_used, 0) as filter_hours_used, last_reset_ts
       FROM device_states WHERE device_key = $1`,
      [device_key]
    );

    if (stateResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Device state not found" };
    }

    const state = stateResult.rows[0];
    const previousFilterHours = parseFloat(String(state.filter_hours_used || 0));

    // Query all completed runtime_sessions since last reset
    // Apply the countsTowardFilter logic based on equipment_status
    const sessionsResult = await client.query<{
      equipment_status: string | null;
      runtime_seconds: number;
    }>(
      `SELECT equipment_status, COALESCE(runtime_seconds, 0) as runtime_seconds
       FROM runtime_sessions
       WHERE device_key = $1
         AND ended_at IS NOT NULL
         ${state.last_reset_ts ? `AND ended_at >= $2` : ""}
       ORDER BY ended_at ASC`,
      state.last_reset_ts ? [device_key, state.last_reset_ts] : [device_key]
    );

    // Calculate filter hours based on current use_forced_air_for_heat setting
    let newFilterHours = 0;
    for (const session of sessionsResult.rows) {
      if (countsTowardFilter(session.equipment_status, device.use_forced_air_for_heat)) {
        newFilterHours += session.runtime_seconds / 3600.0;
      }
    }

    // Calculate filter usage percentage
    const filterUsagePercent = Math.min(
      100,
      Math.round((newFilterHours / device.filter_target_hours) * 100)
    );

    // Update device_states with recalculated filter hours
    await client.query(
      `UPDATE device_states
       SET filter_hours_used = $1, updated_at = NOW()
       WHERE device_key = $2`,
      [newFilterHours, device_key]
    );

    // Update devices with recalculated filter usage percent
    await client.query(
      `UPDATE devices
       SET filter_usage_percent = $1, updated_at = NOW()
       WHERE device_key = $2`,
      [filterUsagePercent, device_key]
    );

    await client.query("COMMIT");

    console.log(
      `[sessionStitcher] Recalculated filter hours for ${device_key}: ` +
      `${previousFilterHours.toFixed(2)}h -> ${newFilterHours.toFixed(2)}h ` +
      `(use_forced_air_for_heat=${device.use_forced_air_for_heat}, usage=${filterUsagePercent}%)`
    );

    return {
      ok: true,
      previous_filter_hours: previousFilterHours,
      new_filter_hours: newFilterHours,
      use_forced_air_for_heat: device.use_forced_air_for_heat ?? false,
    };
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error(`[sessionStitcher] Error recalculating filter hours: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    client.release();
  }
}

/**
 * Recalculates filter_hours_used for ALL devices based on runtime_sessions.
 * This is useful as a one-time fix when use_forced_air_for_heat settings
 * were incorrect or when the calculation logic has been updated.
 *
 * @returns Object with summary of recalculations
 */
export async function recalculateAllFilterHours(): Promise<{
  ok: boolean;
  devices_processed: number;
  devices_updated: number;
  devices_failed: number;
  details: Array<{
    device_key: string;
    device_name: string | null;
    use_forced_air_for_heat: boolean;
    previous_hours: number;
    new_hours: number;
    difference: number;
  }>;
  errors: Array<{ device_key: string; error: string }>;
}> {
  console.log(`[sessionStitcher] Recalculating filter hours for ALL devices...`);

  const details: Array<{
    device_key: string;
    device_name: string | null;
    use_forced_air_for_heat: boolean;
    previous_hours: number;
    new_hours: number;
    difference: number;
  }> = [];
  const errors: Array<{ device_key: string; error: string }> = [];

  try {
    // Get all devices with their device_states
    const devicesResult = await pool.query<{
      device_key: string;
      device_name: string | null;
    }>(`SELECT device_key, device_name FROM devices ORDER BY device_name`);

    console.log(`[sessionStitcher] Found ${devicesResult.rows.length} devices to process`);

    for (const device of devicesResult.rows) {
      const result = await recalculateFilterHours(device.device_key);

      if (result.ok) {
        const difference = (result.new_filter_hours || 0) - (result.previous_filter_hours || 0);
        details.push({
          device_key: device.device_key,
          device_name: device.device_name,
          use_forced_air_for_heat: result.use_forced_air_for_heat || false,
          previous_hours: result.previous_filter_hours || 0,
          new_hours: result.new_filter_hours || 0,
          difference,
        });

        if (Math.abs(difference) > 0.01) {
          console.log(
            `[sessionStitcher] ${device.device_name || device.device_key}: ` +
            `${result.previous_filter_hours?.toFixed(2)}h -> ${result.new_filter_hours?.toFixed(2)}h ` +
            `(${difference > 0 ? '+' : ''}${difference.toFixed(2)}h)`
          );
        }
      } else {
        errors.push({
          device_key: device.device_key,
          error: result.error || 'Unknown error',
        });
        console.warn(`[sessionStitcher] Failed for ${device.device_key}: ${result.error}`);
      }
    }

    const devicesUpdated = details.filter(d => Math.abs(d.difference) > 0.01).length;

    console.log(
      `[sessionStitcher] Recalculation complete: ` +
      `${devicesResult.rows.length} processed, ${devicesUpdated} updated, ${errors.length} failed`
    );

    return {
      ok: true,
      devices_processed: devicesResult.rows.length,
      devices_updated: devicesUpdated,
      devices_failed: errors.length,
      details,
      errors,
    };
  } catch (err: any) {
    console.error(`[sessionStitcher] Error in recalculateAllFilterHours: ${err.message}`);
    return {
      ok: false,
      devices_processed: 0,
      devices_updated: 0,
      devices_failed: 0,
      details,
      errors: [{ device_key: 'global', error: err.message }],
    };
  }
}

/**
 * Backfill runtime_sessions from equipment_events that have runtime_seconds
 * but don't have a corresponding runtime_session.
 * This is useful when events were processed before the fix that handles
 * events without previous_status.
 */
export async function backfillRuntimeSessions(options?: { days?: number }) {
  const days = options?.days || 30;
  console.log(`[sessionStitcher] Backfilling runtime sessions for last ${days} days...`);

  const client = await pool.connect();
  let created = 0;
  let skipped = 0;

  try {
    await client.query("BEGIN");

    // Find equipment_events with runtime_seconds that don't have matching runtime_sessions
    // Use date_trunc to handle timestamp precision differences (microseconds vs milliseconds)
    const events = await client.query(`
      SELECT
        ee.id,
        ee.device_key,
        ee.equipment_status,
        ee.previous_status,
        ee.runtime_seconds,
        ee.recorded_at
      FROM equipment_events ee
      WHERE ee.runtime_seconds > 0
        AND ee.recorded_at >= CURRENT_DATE - INTERVAL '${days} days'
        AND NOT EXISTS (
          SELECT 1 FROM runtime_sessions rs
          WHERE rs.device_key = ee.device_key
            AND rs.terminated_reason = 'posted_runtime'
            AND date_trunc('second', rs.ended_at) = date_trunc('second', ee.recorded_at)
            AND rs.runtime_seconds = ee.runtime_seconds
        )
      ORDER BY ee.recorded_at ASC
    `);

    console.log(`[sessionStitcher] Found ${events.rows.length} events to backfill`);

    for (const e of events.rows) {
      const status = e.previous_status || e.equipment_status;

      if (!status) {
        console.log(`[sessionStitcher] Skipping event ${e.id}: no status available`);
        skipped++;
        continue;
      }

      const mode = deriveMode(status, null);
      const ended_at = dayjs.utc(e.recorded_at).toISOString();
      const started_at = dayjs.utc(e.recorded_at).subtract(e.runtime_seconds, 'second').toISOString();

      await client.query(
        `INSERT INTO runtime_sessions (
          device_key, mode, equipment_status, started_at, ended_at,
          runtime_seconds, tick_count, terminated_reason, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'posted_runtime', NOW(), NOW())`,
        [e.device_key, mode, status, started_at, ended_at, e.runtime_seconds]
      );

      console.log(
        `[sessionStitcher] Created session: device=${e.device_key}, mode=${mode}, ` +
        `runtime=${e.runtime_seconds}s, ended_at=${ended_at}`
      );
      created++;
    }

    await client.query("COMMIT");
    console.log(`[sessionStitcher] Backfill complete: ${created} sessions created, ${skipped} skipped`);

    return { ok: true, created, skipped };
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error("[sessionStitcher] Backfill error:", err.message);
    return { ok: false, error: err.message };
  } finally {
    client.release();
  }
}

// Allow manual worker trigger
if (require.main === module) {
  runSessionStitcher()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
