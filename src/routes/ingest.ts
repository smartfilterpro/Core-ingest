import express from 'express';
import { pool } from '../db';
import { z } from 'zod';

const router = express.Router();

const eventSchema = z.object({
  source: z.string(),
  user_id: z.string(),
  device_id: z.string(),
  device_name: z.string(),
  zip_prefix: z.string().nullable().optional(),
  is_active: z.boolean(),
  is_cooling: z.boolean().optional().default(false),
  is_heating: z.boolean().optional().default(false),
  is_fan_running: z.boolean().optional().default(false),
  current_temperature: z.number().nullable(),
  target_temperature: z.number().nullable(),
  timestamp: z.string(),
  metadata: z.record(z.any()).optional()
});

router.post('/', async (req, res) => {
  try {
    const body = eventSchema.parse(req.body);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Upsert device
      await client.query(
        `INSERT INTO devices (device_id, user_id, name, manufacturer, model, source, zip_prefix)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (device_id) DO UPDATE
         SET name = EXCLUDED.name, source = EXCLUDED.source, zip_prefix = EXCLUDED.zip_prefix`,
        [
          body.device_id,
          body.user_id,
          body.device_name,
          body.metadata?.manufacturer || null,
          body.metadata?.model || null,
          body.source,
          body.zip_prefix || null
        ]
      );

      // 2. Insert equipment event
      await client.query(
        `INSERT INTO equipment_events (device_id, timestamp, is_active, is_cooling, is_heating, is_fan_running, current_temperature, target_temperature)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          body.device_id,
          body.timestamp,
          body.is_active,
          body.is_cooling,
          body.is_heating,
          body.is_fan_running,
          body.current_temperature,
          body.target_temperature
        ]
      );

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Ingest transaction error:', err);
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
