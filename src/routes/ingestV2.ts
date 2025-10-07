import express, { Request, Response } from 'express';
import { pool } from '../db/pool';
import { v4 as uuidv4 } from 'uuid';
import { NormalizedEventV2 } from '../types/NormalizedEventV2';

export const ingestV2Router = express.Router();

/**
 * POST /ingest/v2/events:batch
 * Accepts NormalizedEventV2[] from any vendor microservice
 */
ingestV2Router.post('/v2/events:batch', async (req: Request, res: Response) => {
  const events: NormalizedEventV2[] = Array.isArray(req.body) ? req.body : [req.body];
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    let inserted = 0;

    for (const e of events) {
      if (!e.device_key) continue;
      inserted++;

      // ───────────── 1️⃣ Upsert into devices ─────────────
      await client.query(
        `
        INSERT INTO devices (
          device_id, name, manufacturer, model, connection_source,
          device_type, firmware_version, serial_number, ip_address, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
        ON CONFLICT (device_id) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, devices.name),
          manufacturer = COALESCE(EXCLUDED.manufacturer, devices.manufacturer),
          model = COALESCE(EXCLUDED.model, devices.model),
          connection_source = COALESCE(EXCLUDED.connection_source, devices.connection_source),
          device_type = COALESCE(EXCLUDED.device_type, devices.device_type),
          firmware_version = COALESCE(EXCLUDED.firmware_version, devices.firmware_version),
          serial_number = COALESCE(EXCLUDED.serial_number, devices.serial_number),
          ip_address = COALESCE(EXCLUDED.ip_address, devices.ip_address),
          updated_at = NOW()
        `,
        [
          e.device_key,
          e.device_name ?? null,
          e.manufacturer ?? null,
          e.model ?? null,
          e.connection_source ?? null,
          e.device_type ?? 'thermostat',
          e.firmware_version ?? null,
          e.serial_number ?? null,
          e.ip_address ?? null
        ]
      );

      // ───────────── 2️⃣ Insert equipment event ─────────────
      const ts = e.observed_at ? new Date(e.observed_at) : new Date();

      await client.query(
        `
        INSERT INTO equipment_events (
          device_key, observed_at, is_active, equipment_status, hvac_status,
          temperature_f, temperature_c, humidity, outdoor_temperature_f,
          outdoor_humidity, pressure_hpa, heat_setpoint_f, cool_setpoint_f,
          target_humidity, runtime_seconds, source_vendor, payload_raw, created_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW()
        )
        `,
        [
          e.device_key,
          ts,
          e.is_active ?? false,
          e.equipment_status ?? 'OFF',
          e.hvac_mode ?? null,
          e.temperature_f ?? null,
          e.temperature_c ?? null,
          e.humidity ?? null,
          e.outdoor_temperature_f ?? null,
          e.outdoor_humidity ?? null,
          e.pressure_hpa ?? null,
          e.heat_setpoint_f ?? null,
          e.cool_setpoint_f ?? null,
          e.target_humidity ?? null,
          e.runtime_seconds ?? null,
          e.connection_source ?? null,
          e.payload_raw ?? {}
        ]
      );

      // ───────────── 3️⃣ Update device_status runtime flags ─────────────
      await client.query(
        `
        INSERT INTO device_status (device_key, is_running, last_equipment_status, updated_at)
        VALUES ($1,$2,$3,NOW())
        ON CONFLICT (device_key) DO UPDATE SET
          is_running = EXCLUDED.is_running,
          last_equipment_status = EXCLUDED.last_equipment_status,
          updated_at = NOW()
        `,
        [e.device_key, e.is_active ?? false, e.equipment_status ?? 'OFF']
      );

      // ───────────── 4️⃣ Manage runtime_sessions transitions ─────────────
      const prev = await client.query(
        `SELECT session_id, started_at FROM runtime_sessions
         WHERE device_key=$1 AND ended_at IS NULL
         ORDER BY started_at DESC LIMIT 1`,
        [e.device_key]
      );

      if (e.is_active && prev.rowCount === 0) {
        await client.query(
          `INSERT INTO runtime_sessions (device_key, session_id, started_at, mode, is_counted, created_at)
           VALUES ($1,$2,$3,$4,TRUE,NOW())`,
          [e.device_key, uuidv4(), ts, e.hvac_mode ?? e.equipment_status ?? 'UNKNOWN']
        );
      } else if (!e.is_active && prev.rowCount > 0) {
        const session = prev.rows[0];
        const runtimeSeconds = e.runtime_seconds ??
          Math.round((ts.getTime() - new Date(session.started_at).getTime()) / 1000);
        await client.query(
          `UPDATE runtime_sessions
           SET ended_at=$2, runtime_seconds=$3, updated_at=NOW()
           WHERE session_id=$1`,
          [session.session_id, ts, runtimeSeconds]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`[ingestV2] Inserted ${inserted} event(s).`);
    res.status(200).json({ ok: true, count: inserted });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[ingestV2] Error:', err);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

/** Health endpoint */
ingestV2Router.get('/v2/health', async (_req, res) => {
  try {
    const r = await pool.query('SELECT NOW() as now');
    res.status(200).json({ ok: true, db_time: r.rows[0].now });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default ingestV2Router;
