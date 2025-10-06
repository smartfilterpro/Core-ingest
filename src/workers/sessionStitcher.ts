import { pool } from '../db/pool';

/**
 * Session Stitcher Worker
 * -----------------------
 * Groups sequential equipment_events into runtime_sessions per device.
 * Respects device.use_forced_air_for_heat to decide whether to count HEATING sessions.
 */

export async function runSessionStitcher() {
  console.log('[sessionStitcher] 🧩 Starting session stitching...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1️⃣ Load all devices with their forced-air flag
    const { rows: deviceRows } = await client.query(`
      SELECT device_id, use_forced_air_for_heat
      FROM devices
    `);

    const deviceMap = new Map<string, boolean>();
    for (const row of deviceRows) {
      deviceMap.set(row.device_id, row.use_forced_air_for_heat ?? true);
    }

    // 2️⃣ Get recent events that haven’t yet been sessionized
    const { rows: events } = await client.query(`
      SELECT id, device_id, event_type, equipment_status, event_timestamp, runtime_seconds
      FROM equipment_events
      WHERE event_timestamp > NOW() - INTERVAL '2 days'
      ORDER BY device_id, event_timestamp ASC
    `);

    console.log(`[sessionStitcher] Loaded ${events.length} recent events`);

    // 3️⃣ Iterate and stitch sessions
    let sessionsCreated = 0;

    for (const event of events) {
      const deviceId = event.device_id;
      const status = event.equipment_status;
      const ts = new Date(event.event_timestamp);
      const runtime = event.runtime_seconds ?? 0;

      const allowHeat = deviceMap.get(deviceId) ?? true;
      const isHeating = status === 'HEATING';
      const isCooling = status === 'COOLING';
      const isFan = status === 'FAN' || status === 'ON' || status === 'IDLE_FAN';

      // 🧠 Countable if not heating, or heating + forced-air allowed
      const isCounted = (isCooling || isFan) || (isHeating && allowHeat);

      // 4️⃣ Log if heat runtime ignored
      if (!isCounted && isHeating) {
        console.log(
          `[sessionStitcher] ⚠️ Ignoring HEAT session for ${deviceId} (forced_air_for_heat=false)`
        );
      }

      // 5️⃣ Insert into runtime_sessions only if counted
      if (isCounted) {
        await client.query(
          `
          INSERT INTO runtime_sessions (
            device_id,
            started_at,
            ended_at,
            duration_seconds,
            mode,
            is_counted,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
          ON CONFLICT DO NOTHING
          `,
          [
            deviceId,
            ts,
            ts,
            runtime,
            isHeating ? 'HEAT' : isCooling ? 'COOL' : 'FAN',
          ]
        );
        sessionsCreated++;
      } else {
        // Optional: track ignored runtime sessions (non-forced-air heat)
        await client.query(
          `
          INSERT INTO runtime_sessions (
            device_id,
            started_at,
            ended_at,
            duration_seconds,
            mode,
            is_counted,
            created_at
          )
          VALUES ($1, $2, $3, $4, 'HEAT', FALSE, NOW())
          ON CONFLICT DO NOTHING
          `,
          [deviceId, ts, ts, runtime]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`[sessionStitcher] ✅ Completed session stitching (${sessionsCreated} sessions counted)`);

    return { ok: true, sessionsCreated };
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[sessionStitcher] ❌ Error stitching sessions:', err);
    return { ok: false, error: err.message };
  } finally {
    client.release();
  }
}

// Allow manual worker trigger (via /workers/run-all)
if (require.main === module) {
  runSessionStitcher()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
