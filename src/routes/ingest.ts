import express from 'express';
import { pool } from '../database/db';   // ✅ Corrected import path
import { z } from 'zod';

const router = express.Router();

const ingestSchema = z.object({
  source: z.string(),
  user_id: z.string(),
  device_id: z.string(),
  device_name: z.string(),
  zip_prefix: z.string().nullable().optional(),
  is_active: z.boolean(),
  is_cooling: z.boolean().optional().default(false),
  is_heating: z.boolean().optional().default(false),
  is_fan_running: z.boolean().optional().default(false),
  is_fan_only: z.boolean().optional().default(false),
  is_reachable: z.boolean().optional().default(true),
  current_temperature_f: z.number().nullable().optional(),
  current_temperature_c: z.number().nullable().optional(),
  humidity_percent: z.number().nullable().optional(),
  target_temperature_f: z.number().nullable().optional(),
  target_temperature_c: z.number().nullable().optional(),
  heat_setpoint_f: z.number().nullable().optional(),
  heat_setpoint_c: z.number().nullable().optional(),
  cool_setpoint_f: z.number().nullable().optional(),
  cool_setpoint_c: z.number().nullable().optional(),
  hvac_mode: z.string().nullable().optional(),
  equipment_status: z.string().nullable().optional(),
  runtime_seconds: z.number().nullable().optional(),
  runtime_minutes: z.number().nullable().optional(),
  is_runtime_event: z.boolean().optional().default(false),
  timestamp: z.string(),
  metadata: z.record(z.any()).optional()
});

router.post('/', async (req, res) => {
  try {
    const data = ingestSchema.parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO devices (device_id, user_id, name, source, manufacturer, model, zip_prefix)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (device_id) DO UPDATE
         SET name = EXCLUDED.name, source = EXCLUDED.source, manufacturer = EXCLUDED.manufacturer, model = EXCLUDED.model, zip_prefix = EXCLUDED.zip_prefix`,
        [
          data.device_id,
          data.user_id,
          data.device_name,
          data.source,
          data.metadata?.manufacturer || null,
          data.metadata?.model || null,
          data.zip_prefix || null
        ]
      );

      await client.query(
        `INSERT INTO equipment_events (
          device_id, timestamp, is_active, is_cooling, is_heating, is_fan_running, is_fan_only,
          is_reachable, current_temperature_f, current_temperature_c, humidity_percent,
          target_temperature_f, target_temperature_c, heat_setpoint_f, heat_setpoint_c,
          cool_setpoint_f, cool_setpoint_c, hvac_mode, equipment_status, runtime_seconds,
          runtime_minutes, is_runtime_event, metadata
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,
          $12,$13,$14,$15,
          $16,$17,$18,$19,$20,
          $21,$22,$23
        )`,
        [
          data.device_id,
          data.timestamp,
          data.is_active,
          data.is_cooling,
          data.is_heating,
          data.is_fan_running,
          data.is_fan_only,
          data.is_reachable,
          data.current_temperature_f,
          data.current_temperature_c,
          data.humidity_percent,
          data.target_temperature_f,
          data.target_temperature_c,
          data.heat_setpoint_f,
          data.heat_setpoint_c,
          data.cool_setpoint_f,
          data.cool_setpoint_c,
          data.hvac_mode,
          data.equipment_status,
          data.runtime_seconds,
          data.runtime_minutes,
          data.is_runtime_event,
          JSON.stringify(data.metadata || {})
        ]
      );

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err: any) {   // ✅ Explicit typing
      await client.query('ROLLBACK');
      console.error('Error in ingest transaction:', err.message || err);
      res.status(500).json({ success: false, error: err.message || 'Unknown error' });
    } finally {
      client.release();
    }
  } catch (err: any) {   // ✅ Explicit typing
    console.error('Validation failed:', err.message || err);
    res.status(400).json({ success: false, error: err.message || 'Validation error' });
  }
});

export default router;