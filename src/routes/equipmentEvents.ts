import express, { Request, Response } from 'express';
import { pool } from '../db/pool';

const router = express.Router();

/**
 * GET /equipment-events
 * Get equipment events for a device
 * Params: device_key OR device_id, limit, offset, days
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { device_key, device_id, limit = 100, offset = 0, days } = req.query;

    if (!device_key && !device_id) {
      return res.status(400).json({ ok: false, error: 'device_key or device_id is required' });
    }

    // Build date filter
    const dateFilter = days
      ? `AND ee.recorded_at >= CURRENT_DATE - INTERVAL '${parseInt(days as string)} days'`
      : '';

    const query = device_id
      ? `
        SELECT
          ee.id,
          ee.device_key,
          ee.event_type,
          ee.equipment_status,
          ee.is_active,
          ee.hvac_mode,
          ee.thermostat_mode,
          ee.fan_mode,
          ee.last_temperature,
          ee.last_humidity,
          ee.target_temperature,
          ee.runtime_seconds,
          ee.recorded_at,
          ee.event_timestamp
        FROM equipment_events ee
        JOIN devices d ON d.device_key = ee.device_key
        WHERE d.device_id = $1
          ${dateFilter}
        ORDER BY ee.recorded_at DESC
        LIMIT $2 OFFSET $3
      `
      : `
        SELECT
          id,
          device_key,
          event_type,
          equipment_status,
          is_active,
          hvac_mode,
          thermostat_mode,
          fan_mode,
          last_temperature,
          last_humidity,
          target_temperature,
          runtime_seconds,
          recorded_at,
          event_timestamp
        FROM equipment_events
        WHERE device_key = $1
          ${dateFilter}
        ORDER BY recorded_at DESC
        LIMIT $2 OFFSET $3
      `;

    const params = [device_id || device_key, limit, offset];
    const { rows } = await pool.query(query, params);
    
    res.json({
      ok: true,
      count: rows.length,
      events: rows,
    });
  } catch (err: any) {
    console.error('[equipment-events/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
