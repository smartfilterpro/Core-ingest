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
      // --- Normalize and remap field names ---
      const device_key = e.device_key || e.device_id || uuidv4();
      const device_id = e.device_id || e.device_key;
      const workspace_id = e.workspace_id || e.user_id || 'unknown';
      const event_time = e.timestamp || e.recorded_at || new Date().toISOString();

      const temperature_f = parseFloat(e.last_temperature) || e.temperature_f || null;
      const humidity = e.last_humidity || e.humidity || null;
      const heat_setpoint_f = e.last_heat_setpoint || e.heat_setpoint_f || null;
      const cool_setpoint_f = e.last_cool_setpoint || e.cool_setpoint_f || null;
      const runtime_seconds = e.runtime_seconds || null;
      const equipment_status = e.equipment_status || 'OFF';
      const event_type = e.event_type || 'UNKNOWN';
      const source_event_id = e.source_event_id || uuidv4();

      console.log(
        `   ↳ ${e.source || 'unknown'} | ${device_id} | ${event_type} | status=${equipment_status} | runtime=${runtime_seconds} | temp=${temperature_f} | humidity=${humidity}`
      );

      // --- Ensure device exists ---
      await client.query(
        `
        INSERT INTO devices (device_key, device_id, workspace_id, device_name, manufacturer, model, source, connection_source, created_at, updated_at)
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

      // --- Update device_status ---
      await client.query(
        `
        INSERT INTO device_status (device_key, device_name, is_reachable, last_mode, current_equipment_status, last_temperature, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,NOW())
        ON CONFLICT (device_key) DO UPDATE
        SET 
          is_reachable = EXCLUDED.is_reachable,
          last_mode = EXCLUDED.last_mode,
          current_equipment_status = EXCLUDED.current_equipment_status,
          last_temperature = EXCLUDED.last_temperature,
          updated_at = NOW()
        `,
        [
          device_key,
          e.device_name || null,
          e.is_reachable ?? true,
          e.last_mode || 'off',
          equipment_status,
          temperature_f
        ]
      );

      // --- Insert into equipment_events ---
      await client.query(
        `
        INSERT INTO equipment_events (
          id, device_key, source_event_id, event_type, is_active,
          equipment_status, previous_status, temperature_f, humidity,
          heat_setpoint_f, cool_setpoint_f, runtime_seconds,
          recorded_at, source_vendor, payload_raw, created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
        ON CONFLICT (source_event_id) DO NOTHING
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
          humidity,
          heat_setpoint_f,
          cool_setpoint_f,
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
