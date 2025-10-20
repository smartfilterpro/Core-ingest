import express, { Request, Response } from 'express';
import { pool } from '../db/pool';

const router = express.Router();

/**
 * GET /equipment-events
 * Get equipment events for a device
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { device_key, limit = 100, offset = 0 } = req.query;
    
    if (!device_key) {
      return res.status(400).json({ ok: false, error: 'device_key is required' });
    }
    
    const { rows } = await pool.query(
      `
      SELECT 
        id,
        device_key,
        event_type,
        equipment_status,
        is_active,
        last_temperature,
        last_humidity,
        runtime_seconds,
        recorded_at,
        event_timestamp
      FROM equipment_events
      WHERE device_key = $1
      ORDER BY recorded_at DESC
      LIMIT $2 OFFSET $3
      `,
      [device_key, limit, offset]
    );
    
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
