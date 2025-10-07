import express, { Request, Response } from 'express';
import { pool } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';

export const ingestRouter = express.Router();

/**
 * Helper to safely stringify JSON without breaking Postgres JSONB
 */
function safeJson(value: any): string | null {
  try {
    if (!value) return null;
    const jsonStr = JSON.stringify(value);
    // If it’s massive, wrap safely so it’s still valid JSON
    if (jsonStr.length > 8000) {
      const truncated = jsonStr.substring(0, 7990);
      return JSON.stringify({ truncated: true, data: truncated });
    }
    return jsonStr;
  } catch (err: any) {
    console.error('[ingest] ⚠️ Failed to stringify payload_raw:', err.message);
    return JSON.stringify({ error: 'stringify_failed' });
  }
}

/**
 * POST /ingest/v1/events:batch
 * Accepts normalized device events from vendor services
 */
ingestRouter.post('/v1/events:batch', async (req: Request, res: Response) => {
  let events: any[] = [];

  // Handle both array or { events: [] } wrapper
  if (Array.isArray(req.body)) {
    events = req.body;
  } else if (req.body.events && Array.isArray(req.body.events)) {
    events = req.body.events;
  } else {
    events = [req.body];
  }

  const client = await pool.connect();
  const insertedEvents: string[] = [];
  const startTime = Date.now();

  try {
    console.log('\n📥 [ingest] Incoming batch:', events.length, 'event(s)');
    for (const e of events) {
      console.log(
        `   ↳ ${e.source || 'unknown'} | ${e.device_id || e.device_key || 'no-id'} | ${e.event_type || 'no-type'} | ` +
        `status=${e.equipment_status || 'unknown'} | active=${e.is_active ?? 'n/a'} | ` +
        `temp=${e.temperature_f ?? e.temperature_c ?? '—'} | runtime=${e.runtime_seconds ?? '—'}`
      );
    }

    await client.query('BEGIN');

    for (const e of events) {
      if (!e.device_key && !e.device_id) {
        console.warn('[ingest] Skipping event with no device_key/device_id', e);
        continue;
      }

      const source = (e.source || 'unknown').toLowerCase();
      const connection_source = (e.connection_source || 'unknown').toLowerCase();

      let device_key = e.device_key;
      const device_id = e.device_id || e.device_key;

      // Lookup existing key if needed
      if (!device_key) {
        const lookup = await client.query(
          'SELECT device_key FROM devices WHERE device_id = $1',
          [device_id]
        );
        device_key = lookup.rows[0]?.device_key || uuidv4();
      }

      const eventTimestamp =
        e.timestamp && !isNaN(Date.parse(e.timestamp))
          ? new Date(e.timestamp)
          : new Date();

      // --- UPSERT devices ---
      await client.query(
        `
        INSERT INTO devices (
          device_key, device_id, workspace_id, device_name, manufacturer, model,
          source, connection_source, zip_code_prefix, timezone, firmware_version,
          created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
        ON CONFLICT (device_key) DO UPDATE
        SET device_name = COALESCE(EXCLUDED.device_name, devices.device_name),
            manufacturer = COALESCE(EXCLUDED.manufacturer, devices.manufacturer),
            model = COALESCE(EXCLUDED.model, devices.model),
            zip_code_prefix = COALESCE(EXCLUDED.zip_code_prefix, devices.zip_code_prefix),
            timezone = COALESCE(EXCLUDED.timezone, devices.timezone),
            firmware_version = COALESCE(EXCLUDED.firmware_version, devices.firmware_version),
            updated_at = NOW()
        `,
        [
          device_key,
          device_id,
          e.workspace_id || 'default',
          e.device_name || null,
          e.manufacturer || 'Unknown',
          e.model || null,
          source,
          connection_source,
          e.zip_code_prefix || null,
          e.timezone || null,
          e.firmware_version || null
        ]
      );

      // --- Update current device state ---
      await client.query(
        `
        UPDATE devices
        SET
          last_mode = COALESCE($2, last_mode),
          last_equipment_status = $3,
          last_is_cooling = CASE 
            WHEN $3 IN ('COOLING','cool') THEN TRUE
            WHEN $3 IN ('OFF','off') THEN FALSE
            ELSE last_is_cooling END,
          last_is_heating = CASE 
            WHEN $3 IN ('HEATING','heat') THEN TRUE
            WHEN $3 IN ('OFF','off') THEN FALSE
            ELSE last_is_heating END,
          last_is_fan_only = CASE 
            WHEN $3 IN ('FAN','fan') OR $4 = TRUE THEN TRUE
            WHEN $3 IN ('OFF','off') THEN FALSE
            ELSE last_is_fan_only END,
          last_temperature = COALESCE($5, last_temperature),
          last_humidity = COALESCE($6, last_humidity),
          last_heat_setpoint = COALESCE($7, last_heat_setpoint),
          last_cool_setpoint = COALESCE($8, last_cool_setpoint),
          updated_at = NOW()
        WHERE device_key = $1
        `,
        [
          device_key,
          e.event_type || null,
          e.equipment_status || 'OFF',
          e.is_fan_running || false,
          e.temperature_f || null,
          e.humidity || null,
          e.heat_setpoint_f || null,
          e.cool_setpoint_f || null
        ]
      );

      // --- Insert event record ---
      await client.query(
        `
        INSERT INTO equipment_events (
          id, device_key, source_event_id, event_type, is_active,
          equipment_status, previous_status, temperature_f, temperature_c,
          humidity, outdoor_temperature_f, outdoor_humidity,
          heat_setpoint_f, cool_setpoint_f, runtime_seconds,
          recorded_at, source_vendor, payload_raw, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                $16 AT TIME ZONE 'UTC',$17,$18,NOW())
        ON CONFLICT (device_key, source_event_id) DO NOTHING
        `,
        [
          uuidv4(),
          device_key,
          e.source_event_id || uuidv4(),
          e.event_type || null,
          e.is_active ?? false,
          e.equipment_status || 'OFF',
          e.previous_status || null,
          e.temperature_f || null,
          e.temperature_c || null,
          e.humidity || null,
          e.outdoor_temp_f || null,
          e.outdoor_humidity || null,
          e.heat_setpoint_f || null,
          e.cool_setpoint_f || null,
          e.runtime_seconds || null,
          eventTimestamp,
          source,
          safeJson(e.payload_raw) // ✅ safe JSON stringifier
        ]
      );

      insertedEvents.push(device_key);
    }

    await client.query('COMMIT');
    console.log(
      `📤 [ingest] ✅ Inserted ${insertedEvents.length} event(s) in ${
        Date.now() - startTime
      }ms`
    );

    res.status(200).json({ ok: true, count: insertedEvents.length });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[ingest] ❌ Error processing batch:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

export default ingestRouter;
