// src/routes/bubbleSync.ts
import express from 'express';
import { pool } from '../db/pool.js';

const router = express.Router();

router.post('/device-sync', async (req, res) => {
  try {
    const { device_id, filter_target_hours, filter_usage_percent } = req.body;

    if (!device_id) {
      return res.status(400).json({ ok: false, error: 'device_id is required' });
    }

    const q = `
      UPDATE devices
      SET
        filter_target_hours = COALESCE($2, filter_target_hours),
        filter_usage_percent = COALESCE($3, filter_usage_percent)
      WHERE device_id = $1
    `;
    await pool.query(q, [device_id, filter_target_hours, filter_usage_percent]);

    res.json({ ok: true, updated: ['devices'] });
  } catch (err: any) {
    console.error('[BubbleSync]', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
