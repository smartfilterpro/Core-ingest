import express, { Request, Response } from 'express';
import { pool } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';

export const ingestRouter = express.Router();

ingestRouter.post('/v1/events:batch', async (req: Request, res: Response) => {
  let raw = req.body;
  let events: any[] = [];

  // Normalize: accept {events:[...]} | [...] | single object
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (item?.events && Array.isArray(item.events)) events.push(...item.events);
      else events.push(item);
    }
  } else if (raw?.events && Array.isArray(raw.events)) {
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
      // --- Normalize fields ---
      const device_key = e.device_key || e.device_id || uuidv4();
      const device_id = e.device_id || e.device_key || null;
      const workspace_id = e.workspace_id || e.user_id || 'unknown';
      const event_time: string = e.timestamp || e.recorded_at || new Date().toISOString();

      const temperature_f =
        e.temperature_f !== undefined
          ? parseFloat(e.temperature_f)
          : e.last_temperature !== undefined
          ? parseFloat(e.last_temperature)
          : null;

      // Auto-convert F → C if missing
      let temperature_c: number | null = null;
      if (e.temperature_c !== undefined) {
        temperature_c = parseFloat(e.temperature_c);
      } else if (temperature_f !== null) {
        temperature_c = ((temperature_f - 32) * 5) / 9;
      }

      const humidity = e.last_humidity ?? e.humidity ?? null;
      const heat_setpoint = e.last_heat_setpoint ?? e.heat_setpoint_f ?? null;
      const cool_setpoint = e.last_cool_setpoint ?? e.cool_setpoint_f ?? null;
      const runtime_seconds = e.runtime_seconds ?? null;
      const equipment_status = e.equipment_status || 'OFF';
      const event_type = e.event_type || 'UNKNOWN';

      // IMPORTANT: runtime stop events reuse the same source_event_id upstream.
      // To ensure append-only logging, mint a new UUID when runtime_seconds > 0.
      const source_event_id: string =
        runtime_seconds && Number(runtime_seconds) > 0
          ? uuidv4()
          : e.source_event_id || uuidv4();

      console.log(
        `   ↳ ${e.source || 'unknown'} | ${device_id} | ${event_type} | status=${equipment_status} | runtime=${runtime_seconds} | temp=${temperature_f}F (${temperature_c?.toFixed(
          2
        )}C)`
      );

      // --- Ensure device exists (idempotent) ---
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

      // --- Upsert device_status snapshot (preserve non-null with COALESCE on UPDATE) ---
      await client.query(
        `
        INSERT INTO device_status (
          device_key, device_name, manufacturer, source_vendor, connection_source,
          is_reachable, last_mode, current_equipment_status,
          last_temperature, current_temp_f, last_temperature_c,
          last_cool_setpoint, last_heat_setpoint, last_equipment_status,
          last_humidity, last_is_heating, last_is_cooling, last_is_fan_only,
          use_forced_air_for_heat, frontend_id, is_running,
          last_fan_timer_until, is_fan_timer_on, last_fan_mode,
          last_activity_at, last_seen_at, last_active, updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
          $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW()
        )
        ON CONFLICT (device_key) DO UPDATE
        SET
          device_name = COALESCE(EXCLUDED.device_name, device_status.device_name),
          manufacturer = COALESCE(EXCLUDED.manufacturer, device_status.manufacturer),
          source_vendor = COALESCE(EXCLUDED.source_vendor, device_status.source_vendor),
          connection_source = COALESCE(EXCLUDED.connection_source, device_status.connection_source),
          is_reachable = COALESCE(EXCLUDED.is_reachable, device_status.is_reachable),
          last_mode = COALESCE(EXCLUDED.last_mode, device_status.last_mode),
          current_equipment_status = COALESCE(EXCLUDED.current_equipment_status, device_status.current_equipment_status),
          last_temperature = COALESCE(EXCLUDED.last_temperature, device_status.last_temperature),
          current_temp_f = COALESCE(EXCLUDED.current_temp_f, device_status.current_temp_f),
          last_temperature_c = COALESCE(EXCLUDED.last_temperature_c, device_status.last_temperature_c),
          last_cool_setpoint = COALESCE(EXCLUDED.last_cool_setpoint, device_status.last_cool_setpoint),
          last_heat_setpoint = COALESCE(EXCLUDED.last_heat_setpoint, device_status.last_heat_setpoint),
          last_equipment_status = COALESCE(EXCLUDED.last_equipment_status, device_status.last_equipment_status),
          last_humidity = COALESCE(EXCLUDED.last_humidity, device_status.last_humidity),
          last_is_heating = COALESCE(EXCLUDED.last_is_heating, device_status.last_is_heating),
          last_is_cooling = COALESCE(EXCLUDED.last_is_cooling, device_status.last_is_cooling),
          last_is_fan_only = COALESCE(EXCLUDED.last_is_fan_only, device_status.last_is_fan_only),
          use_forced_air_for_heat = COALESCE(EXCLUDED.use_forced_air_for_heat, device_status.use_forced_air_for_heat),
          frontend_id = COALESCE(EXCLUDED.frontend_id, device_status.frontend_id),
          is_running = COALESCE(EXCLUDED.is_running, device_status.is_running),
          last_fan_timer_until = COALESCE(EXCLUDED.last_fan_timer_until, device_status.last_fan_timer_until),
          is_fan_timer_on = COALESCE(EXCLUDED.is_fan_timer_on, device_status.is_fan_timer_on),
          last_fan_mode = COALESCE(EXCLUDED.last_fan_mode, device_status.last_fan_mode),
          last_activity_at = COALESCE(EXCLUDED.last_activity_at, device_status.last_activity_at),
          last_seen_at = COALESCE(EXCLUDED.last_seen_at, device_status.last_seen_at),
          last_active = COALESCE(EXCLUDED.last_active, device_status.last_active),
          updated_at = NOW()
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
          temperature_f,
          temperature_c,
          cool_setpoint,
          heat_setpoint,
          e.last_equipment_status || e.equipment_status || null,
          humidity,
          e.last_is_heating ?? null,
          e.last_is_cooling ?? null,
          e.last_is_fan_only ?? null,
          e.use_forced_air_for_heat ?? null,
          e.frontend_id || null,
          e.is_running ?? e.is_active ?? false,
          e.last_fan_timer_until ?? null,
          e.is_fan_timer_on ?? false,
          e.last_fan_mode || null,
          e.is_active ? event_time : null,
          e.is_reachable ? event_time : null,
          e.is_active ?? false
        ]
      );


      // --- Append-only equipment_events insert
      // Use composite dedupe if you've added UNIQUE(device_key, event_type, equipment_status, recorded_at)
      try {
        const result = await client.query(
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
          ON CONFLICT (device_key, event_type, equipment_status, recorded_at) DO NOTHING
          RETURNING id
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
            JSON.stringify(e) // keep raw payload for audit/debug
          ]
        );
        console.log(`   ↳ [equipment_events] rows inserted: ${result.rowCount}`);
      } catch (evErr: any) {
        // If a legacy UNIQUE(source_event_id) still exists, swallow duplicates and continue
        if (evErr?.code === '23505') {
          console.warn(
            `   ⚠️ [equipment_events] duplicate under legacy source_event_id unique: ${source_event_id} (skipped)`
          );
        } else {
          console.error('   ❌ [equipment_events] insert error:', evErr);
        }
      }

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
