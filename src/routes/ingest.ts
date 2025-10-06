import express from 'express';
import { Pool } from 'pg';
import { pool } from '../db/pool'; // ✅ fixed import

export const ingestRouter = express.Router();

ingestRouter.post('/v1/events:batch', async (req, res) => {
  const db: Pool = pool;
  const events = req.body.events || [];

  if (!Array.isArray(events)) {
    return res.status(400).json({ ok: false, error: 'Invalid payload: expected events[]' });
  }

  try {
    for (const e of events) {
      await db.query(`
        INSERT INTO equipment_events (
          device_id,
          event_type,
          is_active,
          equipment_status,
          temperature_f,
          temperature_c,
          runtime_seconds,
          event_timestamp,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT DO NOTHING
      `, [
        e.device_id,
        e.event_type,
        e.is_active,
        e.equipment_status,
        e.temperature_f,
        e.temperature_c,
        e.runtime_seconds,
        e.timestamp
      ]);

      // Ensure device record exists / updated
      await db.query(`
        INSERT INTO devices (device_id, created_at)
        VALUES ($1, NOW())
        ON CONFLICT (device_id) DO NOTHING
    `, [e.device_id]);
    }

    res.json({ success: true, count: events.length });
  } catch (err: any) {
    console.error('[INGEST ERROR]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
