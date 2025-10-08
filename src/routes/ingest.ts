import express, { Request, Response } from 'express';
import { pool } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';

export const ingestRouter = express.Router();

/**
 * POST /ingest/v1/events:batch
 * Accepts normalized device events from vendor services (e.g., Nest, Ecobee, Resideo, etc.)
 * Handles both flat arrays and nested { events: [ ... ] } payloads
 */
ingestRouter.post('/v1/events:batch', async (req: Request, res: Response) => {
  // 🧠 Normalize payload format
  let raw = req.body;
  let events: any[] = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item.events && Array.isArray(item.events)) {
        events.push(...item.events);
      } else {
        events.push(item);
      }
    }
  } else if (raw.events && Array.isArray(raw.events)) {
    events = raw.events;
  } else {
    events = [raw];
  }

  // --- Database client ---
  const client = await pool.connect();
  const insertedEvents: string[] = [];

  // --- Verbose logs ---
  console.log('\n📬 [ingest] Full incoming payload:');
  console.dir(req.body, { depth: null });
  console.log(`📥 [ingest] Normalized ${events.length} event(s):`);

  for (const e of events) {
    console.log(
      `   ↳ ${e.source || 'unknown'} | ${e.device_id || '—'} | ${e.event_type || '—'} | status=${e.equipment_status || '—'} | active=${e.is_active ?? '—'} | temp=${e.temperature_f ?? '—'} | humidity=${e.humidity ?? '—'} | runtime=${e.runtime_seconds ?? '—'}`
    );
  }

  try {
    await client.query('BEGIN');

    for (const e of events) {
      // --- Resolve device_key ---
      let device_key = e.device_key;
      const device_id = e.device_id || e.device_key;

      if (!device_key) {
        const lookup = await client.query(
          'SELECT device_key FROM devices WHERE device_id = $1',
          [device_id]
        );
        if (lookup.rows[0]) {
          device_key = lookup.rows[0].device_key;
        } else {
          device_key = uuidv4();
          console.warn(`[ingest] No existing device_key found, generated new: ${device_key}`);
        }
      }

      const eventTimestamp =
        e.timestamp && !isNaN(Date.parse(e.timestamp))
          ? new Date(e.timestamp)
          : new Date();

      // --- UPSERT into devices table ---
      await client.query(
        `
        INSERT INTO devices (
          device_key, device_id, workspace_id, device_name, manufacturer, model, source,
          connection_source, zip_code_prefix, timezone, firmware_version,
          created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
        ON CONFLICT (device_key) DO UPDATE
        SET
          device_name = COALESCE(EXCLUDED.device_name, devices.device_name),
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
          e.source || 'unknown',
          e.connection_source || 'unknown',
          e.zip_code_prefix || null,
          e.timezone || null,
          e.firmware_version || null
        ]
      );

      // --- Update last-known device state ---
      await client.query(
        `
        UPDATE devices
        SET
          last_mode = COALESCE($2, last_mode),
          last_equipment_status = $3,
          last_is_cooling = CASE WHEN $3 IN ('COOLING','cool') THEN TRUE ELSE last_is_cooling END,
          last_is_heating = CASE WHEN $3 IN ('HEATING','heat') THEN TRUE ELSE last_is_heating END,
          last_is_fan_only = CASE WHEN $3 IN ('FAN','fan') OR $4 = TRUE THEN TRUE ELSE last_is_fan_only END,
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

      // --- Insert into equipment_events ---
      await client.query(
        `
        INSERT INTO equipment_events (
          id, device_key, source_event_id, event_type, is_active,
          equipment_status, previous_status, temperature_f, temperature_c, humidity,
          outdoor_temperature_f, outdoor_humidity, heat_setpoint_f, cool_setpoint_f,
          runtime_seconds, recorded_at, source_vendor, payload_raw, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW())
        ON CONFLICT (source_event_id) DO NOTHING
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
          e.source || 'unknown',
          e.payload_raw ? JSON.stringify(e.payload_raw) : JSON.stringify(e)
        ]
      );

      insertedEvents.push(device_key);
    }

    await client.query('COMMIT');
    console.log(`📤 [ingest] ✅ Inserted ${insertedEvents.length} event(s)\n`);

    return res.status(200).json({ ok: true, count: insertedEvents.length });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[ingest] ❌ Error processing batch:', err);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * PATCH /ingest/update-device
 * Allows Bubble or admin services to update runtime settings
 */
ingestRouter.post('/update-device', async (req, res) => {
  const { device_key, use_forced_air_for_heat } = req.body;

  if (!device_key) {
    return res.status(400).json({ ok: false, error: 'Missing device_key' });
  }

  try {
    await pool.query(
      `
      UPDATE devices
      SET use_forced_air_for_heat = $2, updated_at = NOW()
      WHERE device_key = $1
      `,
      [device_key, use_forced_air_for_heat]
    );

    console.log(`[ingest] Updated device ${device_key} forcedAir=${use_forced_air_for_heat}`);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[ingest] update-device error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /ingest/health
 * Simple DB connectivity check
 */
ingestRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const r = await pool.query('SELECT NOW() AS now');
    return res.status(200).json({ ok: true, db_time: r.rows[0].now });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default ingestRouter;
