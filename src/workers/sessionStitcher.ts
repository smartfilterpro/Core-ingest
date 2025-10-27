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
    SELECT id, equipment_status, is_active, recorded_at
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

  const dur = Math.max(
    0,
    dayjs.utc(ended_at).diff(dayjs.utc(started_at), "second")
  );

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

// Allow manual worker trigger
if (require.main === module) {
  runSessionStitcher()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
