import express, { Request, Response } from 'express';
import { pool } from '../db/pool';

const router = express.Router();

/**
 * GET /summaries/daily
 * Get daily summaries for a device
 */
router.get('/daily', async (req: Request, res: Response) => {
  try {
    const { device_id, days = 30 } = req.query;
    
    if (!device_id) {
      return res.status(400).json({ ok: false, error: 'device_id is required' });
    }
    
    const { rows } = await pool.query(
      `
      SELECT 
        device_id,
        date,
        runtime_seconds_total,
        runtime_sessions_count,
        avg_temperature,
        updated_at
      FROM summaries_daily
      WHERE device_id = $1
        AND date >= CURRENT_DATE - INTERVAL '${parseInt(days as string)} days'
      ORDER BY date DESC
      `,
      [device_id]
    );
    
    res.json({
      ok: true,
      count: rows.length,
      summaries: rows,
    });
  } catch (err: any) {
    console.error('[summaries/daily/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /summaries/device/:deviceId
 * Get aggregated summary for a device
 */
router.get('/device/:deviceId', async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;
    
    const { rows } = await pool.query(
      `
      SELECT 
        device_id,
        SUM(runtime_seconds_total) as total_runtime_seconds,
        SUM(runtime_sessions_count) as total_sessions,
        AVG(avg_temperature) as avg_temperature,
        COUNT(*) as days_recorded
      FROM summaries_daily
      WHERE device_id = $1
      GROUP BY device_id
      `,
      [deviceId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'No summary data found' });
    }
    
    res.json({
      ok: true,
      summary: rows[0],
    });
  } catch (err: any) {
    console.error('[summaries/device/GET] Error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
