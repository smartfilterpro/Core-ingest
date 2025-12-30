import express from 'express';
import { pool } from '../db/pool.js';

export const deviceStatusRouter = express.Router();

/**
 * GET /:deviceKey
 * Returns the current status for a device
 */
deviceStatusRouter.get('/:deviceKey', async (req, res) => {
  try {
    const { deviceKey } = req.params;

    const query = `
      SELECT
        device_key,
        device_name,
        is_reachable,
        last_temperature,
        current_equipment_status,
        last_seen_at,
        last_humidity
      FROM device_status
      WHERE device_key = $1;
    `;

    const result = await pool.query(query, [deviceKey]);

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'Device not found' });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error('[DeviceStatus GET]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /ingest/v1/device-status
 * Upserts connectivity state for a device
 */
deviceStatusRouter.post('/v1/device-status', async (req, res) => {
  try {
    const { device_id, is_reachable, last_seen_at, manufacturer, connection_source } = req.body;

    if (!device_id) {
      return res.status(400).json({ ok: false, error: 'device_id is required' });
    }

    const query = `
      INSERT INTO device_status (
        device_id,
        is_reachable,
        last_seen_at,
        manufacturer,
        connection_source,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (device_id)
      DO UPDATE SET
        is_reachable = EXCLUDED.is_reachable,
        last_seen_at = EXCLUDED.last_seen_at,
        manufacturer = EXCLUDED.manufacturer,
        connection_source = EXCLUDED.connection_source,
        updated_at = NOW();
    `;

    await pool.query(query, [
      device_id,
      is_reachable ?? true,
      last_seen_at ?? new Date(),
      manufacturer ?? null,
      connection_source ?? null
    ]);

    res.json({ ok: true, message: 'Device status updated' });
  } catch (err: any) {
    console.error('[DeviceStatus]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});
