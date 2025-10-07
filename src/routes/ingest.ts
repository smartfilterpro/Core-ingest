import express, { Request, Response } from 'express';
import { pool } from '../db/pool';

export const ingestRouter = express.Router();

/**
 * POST /ingest/v1/events:batch
 * Accepts an array of normalized device events from vendor services (Nest, Ecobee, Resideo, etc.)
 *
 * Example payload:
 * [
 *   {
 *     device_key: "abc123",
 *     event_type: "COOL_ON",
 *     is_active: true,
 *     equipment_status: "COOLING",
 *     temperature_f: 72,
 *     temperature_c: 22.2,
 *     runtime_seconds: null,
 *     timestamp: "2025-10-06T12:34:56.000Z",
 *     current_temp: 72
 *   }
 * ]
 */

/**
 * PATCH/POST from Bubble to update device settings
 */
ingestRouter.post('/update-device', async (req, res) => {
  const { device_key, use_forced_air_for_heat } = req.body;
  if (!device_key) {
    return res.status(400).json({ ok: false, error: 'Missing device_key' });
  }

  try {
    await pool.query(
      `UPDATE devices
       SET use_forced_air_for_heat = $2, updated_at = NOW()
       WHERE device_key = $1`,
      [device_key, use_forced_air_for_heat]
    );
    console.log(`[ingest] Updated device ${device_key} forcedAir=${use_forced_air_for_heat}`);
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[ingest] update-device error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

ingestRouter.post('/v1/events:batch', async (req: Request, res: Response) => {
  const events = Array.isArray(req.body) ? req.body : [req.body];
  const client = await pool.connect();
  const insertedEvents: string[] = [];

  try {
    await client.query('BEGIN');

    for (const e of events) {
      if (!e.device_key) continue;

      // Ensure timestamp exists
      const eventTimestamp =
        e.timestamp && !isNaN(Date.parse(e.timestamp))
          ? new Date(e.timestamp)
          : new Date();

      // ✅ Upsert into devices table
      await client.query(
        `
        INSERT INTO devices (device_key, name, manufacturer, user_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (device_key) DO UPDATE
        SET name = COALESCE(EXCLUDED.name, devices.name),
            manufacturer = COALESCE(EXCLUDED.manufacturer, devices.manufacturer),
            user_id = COALESCE(EXCLUDED.user_id, devices.user_id),
            updated_at = NOW()
        `,
        [
          e.device_key,
          e.device_name ?? null,
          e.manufacturer ?? 'Nest',
          e.user_id ?? null,
        ]
      );

      // ✅ Insert into equipment_events table
      await client.query(
        `
        UPDATE devices
        SET
          last_mode = COALESCE($2, last_mode),
          last_is_cooling = CASE WHEN $3 IN ('COOLING') THEN TRUE ELSE FALSE END,
          last_is_heating = CASE WHEN $3 IN ('HEATING') THEN TRUE ELSE FALSE END,
          last_is_fan_only = CASE WHEN $4 = TRUE THEN TRUE ELSE FALSE END,
          last_equipment_status = $3,
          updated_at = NOW()
        WHERE device_key = $1
        `,
        [
          e.device_key,
          e.event_type ?? null,
          e.equipment_status ?? 'OFF',
          e.equipment_status === 'FAN' || e.event_type?.includes('FAN'),
        ]
      );
      
      await client.query(
        `
        INSERT INTO equipment_events (
          device_key,
          event_type,
          is_active,
          equipment_status,
          temperature_f,
          temperature_c,
          runtime_seconds,
          event_timestamp,
          current_temp,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
        ON CONFLICT DO NOTHING
        `,
        [
          e.device_key,
          e.event_type ?? null,
          e.is_active ?? false,
          e.equipment_status ?? 'OFF',
          e.temperature_f ?? null,
          e.temperature_c ?? null,
          e.runtime_seconds ?? null,
          eventTimestamp,
          e.current_temp ?? e.temperature_f ?? null,
        ]
      );

      insertedEvents.push(e.device_key);
    }

    await client.query('COMMIT');
    console.log(`[ingest] Inserted ${insertedEvents.length} event(s)`);

    return res.status(200).json({
      ok: true,
      count: insertedEvents.length,
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('[ingest] Error processing events batch:', err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Unknown ingest error',
    });
  } finally {
    client.release();
  }
});

/**
 * Simple GET to verify ingest route health
 */
ingestRouter.get('/health', async (_req: Request, res: Response) => {
  try {
    const r = await pool.query(`SELECT NOW() AS now`);
    return res.status(200).json({
      ok: true,
      db_time: r.rows[0].now,
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

export default ingestRouter;
