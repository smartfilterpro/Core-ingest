import express, { Request, Response } from 'express';
import { pool } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';

export const ingestRouter = express.Router();

ingestRouter.post('/v1/events:batch', async (req: Request, res: Response) => {
  let raw = req.body;
  let events: any[] = [];

  // 🧠 Normalize nested payloads like [{ events: [ ... ] }]
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item.events && Array.isArray(item.events)) events.push(...item.events);
      else events.push(item);
    }
  } else if (raw.events && Array.isArray(raw.events)) {
    events = raw.events;
  } else {
    events = [raw];
  }

  const client = await pool.connect();
  const inserted: string[] = [];

  console.log('\n📬 [ingest] Full incoming payload:');
  console.dir(req.body, { depth: null });
  console.log(`📥 [ingest] Normalized ${events.length} event(s)`);

  try {
    await client.query('BEGIN');

    for (const e of events) {
      const device_key = e.device_key || e.device_id || uuidv4();
      const device_id = e.device_id || e.device_key;
      const workspace_id = e.workspace_id || e.user_id || 'unknown';
      const event_time = e.timestamp || e.recorded_at || new Date().toISOString();

      const temperature_f =
        e.temperature_f !== undefined
          ? parseFloat(e.temperature_f)
          : e.last_temperature !== undefined
          ? parseFloat(e.last_temperature)
          : null;

      // --- Auto-convert Fahrenheit → Celsius if missing ---
      let temperature_c: number | null = null;
      if (e.temperature_c !== undefined) {
        temperature_c = parseFloat(e.temperature_c);
      } else if (temperature_f !== null) {
        temperature_c = ((temperature_f - 32) * 5) / 9;
      }

      const humidity = e.last_humidity || e.humidity || null;
      const heat_setpoint = e.last_heat_setpoint || e.heat_setpoint_f || null;
      const cool_setpoint = e.last_cool_setpoint || e.cool_setpoint_f || null;
      const runtime_seconds = e.runtime_seconds || null;
      const equipment_status = e.equipment_status || 'OFF';
      const event_type = e.event_type || 'UNKNOWN';
      const source_event_id = e.source_event_id || uuidv4();

      console.log(
        `   ↳ ${e.source || 'unknown'} | ${device_id} | ${event_type} | status=${equipment_status} | runtime=${runtime_seconds} | temp=${temperature_f}F (${temperature_c?.toFixed(
          2
        )}C)`
      );

      // --- Ensure device record exists ---
      await client.query(
        `
        INSERT INTO devices (
          device_key, device_id, workspace_id, device_name,
          manufacturer, model, source, connection_source,
          created_at, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
        ON CONFLICT (device_key) DO NOTHING
        `,
        [
          device_key,
          device_id,
          workspace_id,
          e.device_name || null,
          e.manufacturer || 'Unknown',
          e.model || null,
          e.source || 'unknown',
          e.connection_source || e.source || 'unknown'
        ]
      );

      // --- Upsert latest state snapshot into device_status ---
      await client.query(
        `
        INSERT INTO device_status (
          device_key, device_name, manufacturer, source_vendor, connection_source,
          is_reachable, last_mode, current_equipment_status,
          last_temperature, current_temp_f, last_temperature_c,
          last_cool_setpoint, last_heat_setpoint,
          last_equipment_status, last_activity_at, last_seen_at, last_active, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
        ON CONFLICT (device_key) DO UPDATE
        SET 
          device_name = EXCLUDED.device_name,
          manufacturer = EXCLUDED.manufacturer,
          source_vendor = EXCLUDED.source_vendor,
          connection_source = EXCLUDED.connection_source,
          is_reachable = EXCLUDED.is_reachable,
          last_mode = EXCLUDED.last_mode,
          current_equipment_status = EXCLUDED.current_equipment_status,
          last_temperature = EXCLUDED.last_temperature,
          current_temp_f = EXCLUDED.current_temp_f,
          last_temperature_c = EXCLUDED.last_temperature_c,
          last_cool_setpoint = EXCLUDED.last_cool_setpoint,
          last_heat_setpoint = EXCLUDED.last_heat_setpoint,
          last_equipment_status = EXCLUDED.last_equipment_status,
          last_activity_at = EXCLUDED.last_activity_at,
          last_seen_at = EXCLUDED.last_seen_at,
          last_active = EXCLUDED.last_active,
          updated_at = NOW();
        `,
        [
          device_key,
          e.device_name || null,
          e.manufacturer || 'Unknown',
          e.source_vendor || e.source || 'unknown',
          e.connection_source || e.source || 'unknown',
          e.is_reachable ?? true,
          e.last_mode || 'off',
          equipment_status,
          temperature_f,
          temperature_f, // → current_temp_f
          temperature_c,
          cool_setpoint,
          heat_setpoint,
          e.last_equipment_status || e.equipment_status || null,
          e.is_active ? event_time : null, // last_activity_at
          e.is_reachable ? event_time : null, // last_seen_at
          e.is_active ?? false
        ]
      );

      // --- Append-only event insert (historical log, deduped by device+type+time) ---
      await client.query(
        `
        INSERT INTO equipment_events (
          id, device_key, source_event_id, event_type, is_active,
          equipment_status, previous_status,
          last_temperature, last_temperature_c, last_humidity,
          last_heat_setpoint, last_cool_setpoint,
          runtime_seconds, recorded_at,
          source_vendor, payload_raw, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
        ON CONFLICT (device_key, event_type, recorded_at) DO NOTHING;
        `,
        [
          uuidv4(),
          device_key,
          source_event_id,
          event_type,
          e.is_active ?? false,
          equipment_status,
          e.previous_status || null,
          temperature_f,
          temperature_c,
          humidity,
          heat_setpoint,
          cool_setpoint,
          runtime_seconds,
          event_time,
          e.source_vendor || e.source || 'unknown',
          JSON.stringify(e)
        ]
      );

      inserted.push(device_key);
    }

    await client.query('COMMIT');
    console.log(`📤 [ingest] ✅ Inserted ${inserted.length} event(s)\n`);
    return res.status(200).json({ ok: true, count: inserted.length });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[ingest] ❌ Error processing batch:', err);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

ingestRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const r = await pool.query('SELECT NOW() AS now');
    res.json({ ok: true, db_time: r.rows[0].now });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default ingestRouter;
 
